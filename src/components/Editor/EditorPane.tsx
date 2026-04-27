import { Editor } from '@monaco-editor/react'
import '@/monaco-init'
import { useStore } from '@/store'
import { useMemo, useRef, useState, useEffect } from 'react'
import { ChevronDown, Play, Code2, FolderOpen, Save, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const RUNNER_MAP: Record<string, { ext: string; cmd: (f: string) => string }> = {
    javascript: { ext: 'js', cmd: f => `node "${f}"` },
    typescript: { ext: 'ts', cmd: f => `npx ts-node "${f}"` },
    jsx: { ext: 'jsx', cmd: f => `node "${f}"` },
    tsx: { ext: 'tsx', cmd: f => `npx ts-node "${f}"` },
    python: { ext: 'py', cmd: f => `python "${f}"` },
    ruby: { ext: 'rb', cmd: f => `ruby "${f}"` },
    php: { ext: 'php', cmd: f => `php "${f}"` },
    shell: { ext: 'sh', cmd: f => `bash "${f}"` },
    bash: { ext: 'sh', cmd: f => `bash "${f}"` },
    powershell: { ext: 'ps1', cmd: f => `pwsh -File "${f}"` },
    go: { ext: 'go', cmd: f => `go run "${f}"` },
    rust: { ext: 'rs', cmd: f => `rustc "${f}" -o /tmp/fterm_rs_out && /tmp/fterm_rs_out` },
}

const LANGUAGES = [
    'javascript', 'typescript', 'jsx', 'tsx', 'python', 'java', 'cpp', 'csharp',
    'go', 'rust', 'ruby', 'php', 'sql', 'html', 'css', 'json', 'markdown', 'yaml',
    'xml', 'shell', 'bash', 'powershell', 'dockerfile', 'plaintext'
]

export default function EditorPane({ tabId }: { tabId: string }) {
    const { tabs, setEditorContent, setEditorLanguage, setEditorFilePath, addTabWithCommand, updateTabTitle } = useStore()
    const tab = useMemo(() => tabs.find(t => t.id === tabId), [tabs, tabId])
    const editorRef = useRef<any>(null)
    const saveToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [showPreview, setShowPreview] = useState(false)
    const [saveToast, setSaveToast] = useState<string | null>(null)

    useEffect(() => {
        let isMounted = true;
        const timeout = setTimeout(() => {
            if (isMounted && isLoading) {
                setLoadError('Editor failed to load within 10 seconds. Check console for details.')
                setIsLoading(false)
            }
        }, 10000)
        return () => {
            isMounted = false;
            clearTimeout(timeout)
        }
    }, [isLoading])

    if (!tab || tab.type !== 'editor') return null

    const content = tab.editorContent !== undefined ? tab.editorContent : '// Type your code here...'
    const language = tab.editorLanguage || 'javascript'
    const isMarkdown = language === 'markdown'

    const handleOpen = async () => {
        const filePath = await window.fterm.fsOpenDialog()
        if (!filePath) return
        try {
            const fileContent = await window.fterm.fsReadFile(filePath)
            const ext = filePath.split('.').pop() || ''
            const langMap: Record<string, string> = { js: 'javascript', ts: 'typescript', jsx: 'jsx', tsx: 'tsx', py: 'python', rb: 'ruby', php: 'php', go: 'go', rs: 'rust', sh: 'bash', ps1: 'powershell', html: 'html', css: 'css', json: 'json', md: 'markdown', yaml: 'yaml', yml: 'yaml', xml: 'xml', sql: 'sql' }
            setEditorContent(tabId, fileContent)
            setEditorFilePath(tabId, filePath)
            if (langMap[ext]) {
                setEditorLanguage(tabId, langMap[ext])
                if (langMap[ext] === 'markdown') setShowPreview(true)
            }
            updateTabTitle(tabId, filePath.split(/[/\\]/).pop() || filePath)
        } catch (err: any) {
            alert(`Failed to open file: ${err.message}`)
        }
    }

    const showSaveConfirmation = (filePath: string) => {
        if (saveToastTimer.current) clearTimeout(saveToastTimer.current)
        setSaveToast(filePath.split(/[/\\]/).pop() || filePath)
        saveToastTimer.current = setTimeout(() => setSaveToast(null), 2500)
    }

    const handleSaveDirect = async (currentContent: string) => {
        const existingPath = tab.editorFilePath
        if (existingPath) {
            try {
                await window.fterm.fsWriteFile(existingPath, currentContent)
                showSaveConfirmation(existingPath)
            } catch (err: any) {
                alert(`Failed to save: ${err.message}`)
            }
            return
        }
        const defaultName = tab.title !== 'Text Editor' ? tab.title : undefined
        const langToExt: Record<string, string> = { javascript: 'js', typescript: 'ts', jsx: 'jsx', tsx: 'tsx', python: 'py', java: 'java', cpp: 'cpp', csharp: 'cs', go: 'go', rust: 'rs', ruby: 'rb', php: 'php', sql: 'sql', html: 'html', css: 'css', json: 'json', markdown: 'md', yaml: 'yaml', xml: 'xml', shell: 'sh', bash: 'sh', powershell: 'ps1', dockerfile: 'dockerfile', plaintext: 'txt' }
        const filters = language && langToExt[language] ? [{ name: 'Code File', extensions: [langToExt[language]] }] : undefined
        const filePath = await window.fterm.fsSaveDialog(defaultName, filters)
        if (!filePath) return
        try {
            await window.fterm.fsWriteFile(filePath, currentContent)
            setEditorFilePath(tabId, filePath)
            updateTabTitle(tabId, filePath.split(/[/\\]/).pop() || filePath)
            showSaveConfirmation(filePath)
        } catch (err: any) {
            alert(`Failed to save: ${err.message}`)
        }
    }

    const handleSave = () => handleSaveDirect(content)

    const handleFormat = async () => {
        if (editorRef.current) {
            try {
                await editorRef.current.getAction('editor.action.formatDocument').run()
            } catch {
                console.log('Formatting not available for this language')
            }
        }
    }

    const handleRun = async () => {
        const runner = RUNNER_MAP[language]
        if (!runner) {
            alert(`Running ${language} is not supported. Supported: ${Object.keys(RUNNER_MAP).join(', ')}`)
            return
        }
        try {
            const filename = `fterm_run_${tabId}.${runner.ext}`
            const filePath = await window.fterm.fsTempWrite(filename, content)
            const displayName = tab.title !== 'Text Editor' ? tab.title : filename
            addTabWithCommand(runner.cmd(filePath), undefined, `▶ ${displayName}`)
        } catch (err: any) {
            alert(`Failed to run: ${err.message}`)
        }
    }

    return (
        <div className="w-full h-full flex flex-col bg-[#1e1e1e] relative">
            {/* Header Bar */}
            <div className="flex items-center gap-3 px-4 py-2 bg-[#252526] border-b border-[#3e3e42]">
                <div className="flex items-center gap-2">
                    <label className="text-sm text-[#cccccc]">Language:</label>
                    <div className="relative">
                        <select
                            value={language}
                            onChange={(e) => {
                                setEditorLanguage(tabId, e.target.value)
                                if (e.target.value !== 'markdown') setShowPreview(false)
                            }}
                            className="appearance-none bg-[#3c3c3c] text-[#cccccc] px-3 py-1 pr-8 rounded text-sm border border-[#555555] hover:border-[#5a5a5a] focus:outline-none focus:border-[#007acc] cursor-pointer"
                        >
                            {LANGUAGES.map(lang => (
                                <option key={lang} value={lang}>{lang}</option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 pointer-events-none w-4 h-4 text-[#cccccc]" />
                    </div>
                </div>

                <div className="h-4 w-px bg-[#555555]" />

                <button
                    onClick={handleOpen}
                    className="flex items-center gap-2 px-3 py-1 text-sm bg-[#3c3c3c] text-[#cccccc] rounded border border-[#555555] hover:bg-[#454545] hover:border-[#007acc] transition-colors"
                >
                    <FolderOpen size={14} />
                    Open
                </button>

                <button
                    onClick={handleSave}
                    className="flex items-center gap-2 px-3 py-1 text-sm bg-[#3c3c3c] text-[#cccccc] rounded border border-[#555555] hover:bg-[#454545] hover:border-[#007acc] transition-colors"
                >
                    <Save size={14} />
                    Save
                </button>

                <div className="h-4 w-px bg-[#555555]" />

                <button
                    onClick={handleFormat}
                    className="flex items-center gap-2 px-3 py-1 text-sm bg-[#3c3c3c] text-[#cccccc] rounded border border-[#555555] hover:bg-[#454545] hover:border-[#007acc] transition-colors"
                >
                    <Code2 size={14} />
                    Format
                </button>

                {isMarkdown && (
                    <button
                        onClick={() => setShowPreview(v => !v)}
                        className={`flex items-center gap-2 px-3 py-1 text-sm rounded border transition-colors ${
                            showPreview
                                ? 'bg-[#007acc] text-white border-[#007acc]'
                                : 'bg-[#3c3c3c] text-[#cccccc] border-[#555555] hover:bg-[#454545] hover:border-[#007acc]'
                        }`}
                    >
                        {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
                        Preview
                    </button>
                )}

                <button
                    onClick={handleRun}
                    className="flex items-center gap-2 px-3 py-1 text-sm bg-[#0e639c] text-white rounded hover:bg-[#1177bb] transition-colors ml-auto"
                >
                    <Play size={14} fill="currentColor" />
                    Run
                </button>
            </div>

            <div className="flex-1 min-h-0 relative flex">
                {isLoading && !loadError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1e1e1e] z-10">
                        <Loader2 className="w-8 h-8 text-[#007acc] animate-spin mb-4" />
                        <span className="text-[#cccccc]">Loading Editor...</span>
                    </div>
                )}
                {loadError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1e1e1e] z-10 text-red-500">
                        <AlertCircle className="w-8 h-8 mb-4" />
                        <span>{loadError}</span>
                    </div>
                )}

                {/* Editor */}
                <div className={`h-full ${isMarkdown && showPreview ? 'w-1/2' : 'w-full'} transition-all`}>
                    <Editor
                        onMount={(editor, monaco) => {
                            editorRef.current = editor
                            setIsLoading(false)
                            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                                const val = editor.getValue()
                                handleSaveDirect(val)
                            })
                        }}
                        height="100%"
                        width="100%"
                        theme="vs-dark"
                        language={language}
                        value={content}
                        onChange={(val) => {
                            if (val !== undefined) {
                                setEditorContent(tabId, val)
                            }
                        }}
                        options={{
                            minimap: { enabled: !showPreview },
                            fontSize: 14,
                            fontFamily: "'Fira Code', 'JetBrains Mono', monospace",
                            wordWrap: 'on',
                            automaticLayout: true,
                            padding: { top: 16 },
                            formatOnPaste: true,
                            formatOnType: true,
                        }}
                    />
                </div>

                {/* Markdown Preview */}
                {isMarkdown && showPreview && (
                    <div className="w-1/2 h-full overflow-y-auto border-l border-[#3e3e42] bg-[#1e1e1e] px-8 py-6 text-[#cccccc] text-sm leading-relaxed markdown-preview">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{content}</ReactMarkdown>
                    </div>
                )}
            </div>

            {/* Save confirmation toast */}
            {saveToast && (
                <div className="absolute bottom-4 right-4 flex items-center gap-2 px-3 py-2 bg-[#1e8a3c] text-white text-sm rounded shadow-lg pointer-events-none z-50 animate-fade-in">
                    <Save size={13} />
                    Saved: {saveToast}
                </div>
            )}
        </div>
    )
}
