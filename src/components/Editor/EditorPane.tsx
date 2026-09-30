import { Editor } from '@monaco-editor/react'
import '@/monaco-init'
import { useStore, useActiveTheme } from '@/store'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Play, Code2, FolderOpen, Save, Loader2, AlertCircle, Eye, EyeOff,
    RotateCcw, Search, WrapText, Check, FileCode, Map, ChevronDown, X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { extForLanguage, languageForPath, runCommandFor } from '@/utils/editorLang'
import LanguagePicker from './LanguagePicker'
import { getRecentFiles, pushRecentFile, removeRecentFile, shortPath } from '@/utils/recentFiles'
import { buildMonacoTheme, monacoThemeId } from '@/utils/monacoTheme'
import { EDITOR_PLACEHOLDER, isTabDirty } from '@/utils/editorDirty'

type Toast = { kind: 'ok' | 'err'; text: string }

export default function EditorPane({ tabId }: { tabId: string }) {
    const { tabs, setEditorContent, setEditorLanguage, setEditorFilePath, markEditorSaved,
        addTabWithCommand, updateTabTitle, settings } = useStore()
    const theme = useActiveTheme()
    const tab = useMemo(() => tabs.find(t => t.id === tabId), [tabs, tabId])
    const editorRef = useRef<any>(null)
    const monacoRef = useRef<any>(null)
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [showPreview, setShowPreview] = useState(false)
    const [toast, setToast] = useState<Toast | null>(null)
    const [wordWrap, setWordWrap] = useState(true)
    const [minimap, setMinimap] = useState(true)
    const [recents, setRecents] = useState<string[]>([])
    const [showRecents, setShowRecents] = useState(false)
    const [pos, setPos] = useState({ line: 1, col: 1, selected: 0, lines: 1 })
    const [staleOnDisk, setStaleOnDisk] = useState(false)
    /** mtime as of the last read or write we performed ourselves */
    const knownMtime = useRef<number | null>(null)
    const previewRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        let isMounted = true
        const timeout = setTimeout(() => {
            if (isMounted && isLoading) {
                setLoadError('Editor failed to load within 10 seconds. Check console for details.')
                setIsLoading(false)
            }
        }, 10000)
        return () => { isMounted = false; clearTimeout(timeout) }
    }, [isLoading])

    useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

    useEffect(() => { setRecents(getRecentFiles()) }, [])

    const say = useCallback((kind: Toast['kind'], text: string) => {
        if (toastTimer.current) clearTimeout(toastTimer.current)
        setToast({ kind, text })
        toastTimer.current = setTimeout(() => setToast(null), kind === 'err' ? 6000 : 2500)
    }, [])

    /* The editor repaints with the rest of the app. Monaco themes are global and
       keyed by id, so defining the same one twice is a no-op refresh. */
    useEffect(() => {
        const monaco = monacoRef.current
        if (!monaco || !theme) return
        const id = monacoThemeId(theme)
        monaco.editor.defineTheme(id, buildMonacoTheme(theme))
        monaco.editor.setTheme(id)
    }, [theme])

    const content = tab?.editorContent !== undefined ? tab.editorContent : EDITOR_PLACEHOLDER
    const language = tab?.editorLanguage || 'javascript'
    const isMarkdown = language === 'markdown'
    const dirty = isTabDirty(tab)
    const filePath = tab?.editorFilePath
    const runnable = runCommandFor(language, 'probe') !== null

    const writeFile = useCallback(async (path: string, text: string) => {
        await window.fterm.fsWriteFile(path, text)
        knownMtime.current = (await window.fterm.fsStat(path))?.mtimeMs ?? null
        setStaleOnDisk(false)
        markEditorSaved(tabId, text)
        updateTabTitle(tabId, path.split(/[\\/]/).pop() || path)
        say('ok', 'Saved ' + (path.split(/[\\/]/).pop() || path))
    }, [tabId, markEditorSaved, updateTabTitle, say])

    /** Save As is also the fallback when a buffer has no path yet. */
    const saveAs = useCallback(async (text: string) => {
        const suggested = tab?.title && tab.title !== 'Text Editor' ? tab.title : undefined
        const ext = extForLanguage(language)
        const filePathNew = await window.fterm.fsSaveDialog(
            suggested, [{ name: language, extensions: [ext] }, { name: 'All files', extensions: ['*'] }])
        if (!filePathNew) return
        try {
            setEditorFilePath(tabId, filePathNew)
            await writeFile(filePathNew, text)
            setRecents(pushRecentFile(filePathNew))
        } catch (err: any) {
            say('err', 'Could not save: ' + (err?.message ?? err))
        }
    }, [tab?.title, language, tabId, setEditorFilePath, writeFile, say])

    const saveNow = useCallback(async (text: string) => {
        if (!filePath) { await saveAs(text); return }
        try {
            await writeFile(filePath, text)
        } catch (err: any) {
            say('err', 'Could not save: ' + (err?.message ?? err))
        }
    }, [filePath, saveAs, writeFile, say])

    /* Ctrl+S is registered inside Monaco too, but only fires while the editor
       itself has focus — this catches the toolbar and preview pane. */
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey)) return
            const k = e.key.toLowerCase()
            if (k === 's') {
                e.preventDefault()
                const text = editorRef.current?.getValue() ?? content
                if (e.shiftKey) saveAs(text)
                else saveNow(text)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [content, saveNow, saveAs])

    /* Another program touched this file. Polling beats a main-process watcher
       here: one stat() every three seconds while the tab is actually visible,
       no descriptor left open on a file the user may want to move or delete. */
    useEffect(() => {
        if (!filePath) { setStaleOnDisk(false); return }
        let alive = true
        const check = async () => {
            if (document.hidden) return
            try {
                const st = await window.fterm.fsStat(filePath)
                if (!alive || !st) return
                if (knownMtime.current !== null && st.mtimeMs > knownMtime.current) setStaleOnDisk(true)
            } catch { /* file went away or fell outside the allowlist — say nothing */ }
        }
        const timer = setInterval(check, 3000)
        check()
        return () => { alive = false; clearInterval(timer) }
    }, [filePath])

    /* Leaving with unsaved work should not be silent, even on a window close. */
    useEffect(() => {
        if (!dirty) return
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [dirty])

    if (!tab || tab.type !== 'editor') return null

    const applyOpenedFile = async (path: string, text: string) => {
        knownMtime.current = (await window.fterm.fsStat(path))?.mtimeMs ?? null
        setStaleOnDisk(false)
        setRecents(pushRecentFile(path))
        const lang = languageForPath(path)
        markEditorSaved(tabId, text)
        setEditorFilePath(tabId, path)
        setEditorLanguage(tabId, lang)
        setShowPreview(lang === 'markdown')
        updateTabTitle(tabId, path.split(/[\\/]/).pop() || path)
    }

    /** Loads a known path into this tab. Used by both the dialog and the recents list. */
    const openPath = async (path: string) => {
        if (dirty && !confirm('This tab has unsaved changes. Open another file anyway?')) return
        try {
            const text = await window.fterm.fsReadFile(path)
            if (text === null) {
                // gone, renamed or moved outside the allowlist — stop offering it
                setRecents(removeRecentFile(path))
                say('err', 'That file is no longer there')
                return
            }
            await applyOpenedFile(path, text)
        } catch (err: any) {
            say('err', 'Could not open: ' + (err?.message ?? err))
        }
    }

    const handleOpen = async () => {
        if (dirty && !confirm('This tab has unsaved changes. Open another file anyway?')) return
        const path = await window.fterm.fsOpenDialog()
        if (path) await openPath(path)
    }

    const handleReload = async () => {
        if (!filePath) return
        if (dirty && !confirm('Discard unsaved changes and reload from disk?')) return
        try {
            const text = await window.fterm.fsReadFile(filePath)
            if (text === null) { say('err', 'Could not read that file'); return }
            knownMtime.current = (await window.fterm.fsStat(filePath))?.mtimeMs ?? null
            setStaleOnDisk(false)
            markEditorSaved(tabId, text)
            say('ok', 'Reloaded from disk')
        } catch (err: any) {
            say('err', 'Could not reload: ' + (err?.message ?? err))
        }
    }

    const handleFormat = async () => {
        const action = editorRef.current?.getAction('editor.action.formatDocument')
        if (!action) { say('err', 'No formatter for ' + language); return }
        try {
            await action.run()
            say('ok', 'Formatted')
        } catch {
            say('err', 'No formatter for ' + language)
        }
    }

    const handleRun = async () => {
        /* A saved file runs from where it lives, so relative imports and the
           working directory behave the way the author expects. Only an unsaved
           buffer goes through the temp directory. */
        let target = filePath
        if (target && dirty) await saveNow(editorRef.current?.getValue() ?? content)
        if (!target) {
            try {
                target = await window.fterm.fsTempWrite(
                    `fterm_run_${tabId}.${extForLanguage(language)}`, content)
            } catch (err: any) {
                say('err', 'Could not stage the file: ' + (err?.message ?? err))
                return
            }
        }
        const cmd = runCommandFor(language, target)
        if (!cmd) { say('err', `FTerm cannot run ${language} files`); return }
        const label = target.split(/[\\/]/).pop() || tab.title
        addTabWithCommand(cmd, undefined, `▶ ${label}`)
    }

    const surface = theme?.background ?? '#1e1e1e'
    const chrome: React.CSSProperties = { background: 'rgba(255,255,255,.045)' }

    return (
        <div className="w-full h-full flex flex-col relative" style={{ background: surface }}>
            {/* Toolbar. The file itself is on the left, what you can do to it on
                the right — and everything about how the text is displayed has
                moved down to the status bar, where it belongs. */}
            <div className="flex items-center gap-1 px-2 h-[34px] border-b border-white/10" style={chrome}>
                <div className="flex items-center gap-2 min-w-0 pl-1 pr-2">
                    <FileCode size={13} className="text-white/40 shrink-0" />
                    <span className="text-[12px] text-white/85 truncate max-w-[220px]"
                        title={filePath || 'This buffer has never been saved'}>
                        {filePath ? filePath.split(/[\\/]/).pop() : 'Untitled'}
                    </span>
                    {dirty && <span className="w-1.5 h-1.5 rounded-full bg-[#e3b341] shrink-0"
                        title="Unsaved changes" />}
                </div>

                <div className="h-4 w-px bg-white/10 mx-1" />

                <div className="relative flex items-center">
                    <ToolBtn icon={<FolderOpen size={13} />} label="Open" onClick={handleOpen}
                        hint="Open a file from disk" />
                    <ToolBtn icon={<ChevronDown size={12} />} hint="Recently opened files"
                        onClick={() => setShowRecents(v => !v)} disabled={recents.length === 0}
                        accent={showRecents} />
                    {showRecents && (
                        <>
                            <div className="fixed inset-0 z-[90]" onClick={() => setShowRecents(false)} />
                            <div className="absolute top-full left-0 mt-1.5 z-[100] w-[300px] rounded-xl border border-white/10 bg-[#12141a] shadow-2xl overflow-hidden py-1">
                                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-white/30">
                                    Recent
                                </div>
                                {recents.map(p => (
                                    <div key={p} className="group flex items-center">
                                        <button
                                            onClick={() => { setShowRecents(false); openPath(p) }}
                                            title={p}
                                            className="flex-1 min-w-0 text-left px-3 py-1.5 text-[12px] text-white/70 hover:bg-white/10 hover:text-white transition-colors truncate"
                                        >
                                            {shortPath(p)}
                                        </button>
                                        <button
                                            onClick={() => setRecents(removeRecentFile(p))}
                                            title="Forget this file"
                                            className="px-2 py-1.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 text-white/70 transition-opacity"
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
                <ToolBtn icon={<Save size={13} />} label="Save"
                    onClick={() => saveNow(editorRef.current?.getValue() ?? content)}
                    hint="Ctrl+S · Ctrl+Shift+S to save as" accent={dirty} />
                <ToolBtn icon={<RotateCcw size={13} />} onClick={handleReload}
                    hint="Re-read this file from disk" disabled={!filePath} />

                <div className="h-4 w-px bg-white/10 mx-1" />

                <ToolBtn icon={<Code2 size={13} />} onClick={handleFormat} hint="Format document" />
                <ToolBtn icon={<Search size={13} />} hint="Find — Ctrl+F"
                    onClick={() => editorRef.current?.getAction('actions.find')?.run()} />
                <ToolBtn icon={<Map size={13} />} hint="Toggle minimap" accent={minimap}
                    onClick={() => setMinimap(v => !v)} />

                {isMarkdown && (
                    <ToolBtn icon={showPreview ? <EyeOff size={13} /> : <Eye size={13} />} label="Preview"
                        onClick={() => setShowPreview(v => !v)}
                        hint="Side-by-side markdown preview" accent={showPreview} />
                )}

                <button
                    onClick={handleRun}
                    disabled={!runnable}
                    title={runnable ? 'Save and run this file in a new terminal tab'
                        : `FTerm has no runner for ${language}`}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-md bg-[#0e639c] text-white hover:bg-[#1177bb] disabled:opacity-25 disabled:hover:bg-[#0e639c] transition-colors ml-auto"
                >
                    <Play size={12} fill="currentColor" />
                    Run
                </button>
            </div>

            {staleOnDisk && (
                <div className="flex items-center gap-3 px-3 py-1.5 text-[12px] bg-[#7a5b12] text-white">
                    <AlertCircle size={13} />
                    <span>This file changed on disk{dirty ? ' — and you have unsaved edits here' : ''}.</span>
                    <button onClick={handleReload}
                        className="px-2 py-0.5 rounded bg-white/15 hover:bg-white/25 transition-colors">
                        Reload
                    </button>
                    <button onClick={() => saveNow(editorRef.current?.getValue() ?? content)}
                        className="px-2 py-0.5 rounded bg-white/15 hover:bg-white/25 transition-colors">
                        Overwrite
                    </button>
                    <button onClick={() => setStaleOnDisk(false)}
                        className="ml-auto px-2 py-0.5 rounded hover:bg-white/15 transition-colors">
                        Dismiss
                    </button>
                </div>
            )}

            <div className="flex-1 min-h-0 relative flex">
                {isLoading && !loadError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{ background: surface }}>
                        <Loader2 className="w-8 h-8 text-[#58a6ff] animate-spin mb-4" />
                        <span className="text-white/70 text-sm">Loading editor…</span>
                    </div>
                )}
                {loadError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center z-10 text-red-400" style={{ background: surface }}>
                        <AlertCircle className="w-8 h-8 mb-4" />
                        <span className="text-sm">{loadError}</span>
                    </div>
                )}

                <div className={`h-full ${isMarkdown && showPreview ? 'w-1/2' : 'w-full'} transition-all`}>
                    <Editor
                        onMount={(editor, monaco) => {
                            editorRef.current = editor
                            monacoRef.current = monaco
                            setIsLoading(false)
                            if (theme) {
                                const id = monacoThemeId(theme)
                                monaco.editor.defineTheme(id, buildMonacoTheme(theme))
                                monaco.editor.setTheme(id)
                            }
                            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
                                () => saveNow(editor.getValue()))
                            editor.addCommand(
                                monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS,
                                () => saveAs(editor.getValue()))
                            const sync = () => {
                                const p = editor.getPosition()
                                const sel = editor.getSelection()
                                const model = editor.getModel()
                                setPos({
                                    line: p?.lineNumber ?? 1,
                                    col: p?.column ?? 1,
                                    selected: sel && model && !sel.isEmpty()
                                        ? model.getValueInRange(sel).length : 0,
                                    lines: model?.getLineCount() ?? 1,
                                })
                            }
                            /* Preview follows the editor proportionally. Mapping
                               source lines to rendered blocks would be exact but
                               needs per-node line data ReactMarkdown does not give
                               us; ratio scrolling is what people expect anyway. */
                            editor.onDidScrollChange(() => {
                                const el = previewRef.current
                                if (!el) return
                                const top = editor.getScrollTop()
                                const max = Math.max(1, editor.getScrollHeight() - editor.getLayoutInfo().height)
                                const ratio = Math.min(1, Math.max(0, top / max))
                                el.scrollTop = ratio * Math.max(0, el.scrollHeight - el.clientHeight)
                            })
                            editor.onDidChangeCursorPosition(sync)
                            editor.onDidChangeCursorSelection(sync)
                            sync()
                        }}
                        height="100%"
                        width="100%"
                        language={language}
                        value={content}
                        onChange={(val) => { if (val !== undefined) setEditorContent(tabId, val) }}
                        options={{
                            minimap: { enabled: minimap && !showPreview },
                            fontSize: settings?.fontSize ?? 14,
                            fontFamily: settings?.fontFamily || "'Fira Code', 'JetBrains Mono', monospace",
                            fontLigatures: true,
                            wordWrap: wordWrap ? 'on' : 'off',
                            automaticLayout: true,
                            padding: { top: 14, bottom: 14 },
                            formatOnPaste: true,
                            formatOnType: true,
                            /* the parts of Monaco that make it feel like an editor
                               rather than a textarea with colours */
                            bracketPairColorization: { enabled: true },
                            guides: { bracketPairs: 'active', indentation: true },
                            stickyScroll: { enabled: true },
                            smoothScrolling: true,
                            cursorBlinking: 'smooth',
                            cursorSmoothCaretAnimation: 'on',
                            mouseWheelZoom: true,
                            linkedEditing: true,
                            renderWhitespace: 'selection',
                            renderLineHighlight: 'all',
                            scrollBeyondLastLine: false,
                            tabSize: 2,
                            detectIndentation: true,
                            suggestSelection: 'first',
                            quickSuggestions: { other: true, comments: false, strings: false },
                            occurrencesHighlight: 'singleFile',
                            scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
                        }}
                    />
                </div>

                {isMarkdown && showPreview && <MarkdownPreview content={content} scrollRef={previewRef} />}
            </div>

            {/* Status bar. Everything here is a control, the way an editor's
                status bar is supposed to be: click the position to jump, the
                language to change it, wrap and indent to toggle them. */}
            <div className="flex items-center gap-1 px-2 h-[24px] text-[11px] text-white/45 border-t border-white/10 select-none"
                style={chrome}>
                <span className={`px-1.5 ${dirty ? 'text-[#e3b341]' : 'text-white/40'}`}>
                    {dirty ? '● Unsaved' : filePath ? 'Saved' : 'Not on disk'}
                </span>
                <span className="truncate max-w-[40%] px-1.5 text-white/35"
                    title={filePath || 'This buffer has never been saved'}>
                    {filePath ?? '—'}
                </span>

                <button
                    onClick={() => editorRef.current?.getAction('editor.action.gotoLine')?.run()}
                    title="Go to line — Ctrl+G"
                    className="ml-auto px-1.5 rounded hover:bg-white/10 hover:text-white transition-colors"
                >
                    Ln {pos.line}, Col {pos.col}
                    {pos.selected > 0 && ` (${pos.selected} sel)`}
                </button>
                <span className="px-1.5 text-white/30">{pos.lines} lines</span>
                <button
                    onClick={() => setWordWrap(v => !v)}
                    title="Toggle word wrap"
                    className={`flex items-center gap-1 px-1.5 rounded hover:bg-white/10 transition-colors ${
                        wordWrap ? 'text-white/70' : 'text-white/30'}`}
                >
                    <WrapText size={11} />Wrap
                </button>
                <LanguagePicker
                    value={language}
                    align="up"
                    onChange={id => {
                        setEditorLanguage(tabId, id)
                        if (id !== 'markdown') setShowPreview(false)
                    }}
                />
            </div>

            {toast && (
                <div
                    className={`absolute bottom-8 right-4 flex items-center gap-2 px-3 py-2 text-white text-[12px] rounded shadow-lg pointer-events-none z-50 animate-fade-in ${
                        toast.kind === 'ok' ? 'bg-[#1e8a3c]' : 'bg-[#a02a2a]'}`}
                >
                    {toast.kind === 'ok' ? <Check size={13} /> : <AlertCircle size={13} />}
                    {toast.text}
                </div>
            )}
        </div>
    )
}

/** Toolbar button. Icon-only when it has no label — the tooltip carries the name. */
function ToolBtn({ icon, label, onClick, hint, accent, disabled }: {
    icon: React.ReactNode; label?: string; onClick: () => void
    hint?: string; accent?: boolean; disabled?: boolean
}) {
    return (
        <button
            onClick={onClick}
            title={hint}
            disabled={disabled}
            className={`flex items-center gap-1.5 h-[24px] rounded-md text-[12px] transition-colors disabled:opacity-25 disabled:pointer-events-none ${
                label ? 'px-2' : 'w-[26px] justify-center'
            } ${
                accent
                    ? 'bg-[#58a6ff]/15 text-[#79c0ff]'
                    : 'text-white/55 hover:bg-white/10 hover:text-white'
            }`}
        >
            {icon}{label}
        </button>
    )
}

const MarkdownPreview = memo(function MarkdownPreview(
    { content, scrollRef }: { content: string; scrollRef: React.RefObject<HTMLDivElement> },
) {
    return (
        <div ref={scrollRef}
            className="w-1/2 h-full overflow-y-auto border-l border-white/10 px-8 py-6 text-white/80 text-sm leading-relaxed markdown-preview custom-scrollbar">
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{content}</ReactMarkdown>
        </div>
    )
})
