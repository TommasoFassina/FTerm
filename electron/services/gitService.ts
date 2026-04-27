import simpleGit, { CheckRepoActions } from 'simple-git'
import { normalize } from 'path'

export interface GitStatus {
    branch: string
    stagedFiles: GitFile[]
    unstagedFiles: GitFile[]
    unmergedFiles: GitFile[]
    hasConflicts: boolean
    ahead: number
    behind: number
}

export interface GitFile {
    path: string
    status: string
    staged: boolean
}

export interface Commit {
    hash: string
    shortHash: string
    author: string
    email: string
    message: string
    date: string
}

export interface Branch {
    name: string
    isHead: boolean
    isRemote: boolean
}

export interface Remote {
    name: string
    url: string
}

function normalizePath(p: string): string {
    if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1)
    return normalize(p)
}

function git(repoPath: string) {
    return simpleGit(normalizePath(repoPath))
}

export class GitService {
    async detectRepository(repoPath: string): Promise<boolean> {
        try {
            const g = git(repoPath)
            return await g.checkIsRepo(CheckRepoActions.IS_REPO_ROOT)
                || await g.checkIsRepo(CheckRepoActions.IN_TREE)
        } catch {
            return false
        }
    }

    async getStatus(repoPath: string): Promise<GitStatus> {
        const status = await git(repoPath).status()

        const stagedFiles: GitFile[] = status.staged.map(f => ({ path: f, status: 'staged', staged: true }))
        const stagedPaths = new Set(stagedFiles.map(f => f.path))

        const unstagedFiles: GitFile[] = [
            ...status.not_added.map(f => ({ path: f, status: 'untracked', staged: false })),
            ...status.modified.filter(f => !stagedPaths.has(f)).map(f => ({ path: f, status: 'modified', staged: false })),
            ...status.deleted.filter(f => !stagedPaths.has(f)).map(f => ({ path: f, status: 'deleted', staged: false })),
            ...status.renamed.filter(f => !stagedPaths.has(f.to)).map(f => ({ path: f.to, status: 'renamed', staged: false }))
        ]

        return {
            branch: status.current || '',
            stagedFiles,
            unstagedFiles,
            unmergedFiles: status.conflicted.map(f => ({ path: f, status: 'conflicted', staged: false })),
            hasConflicts: status.conflicted.length > 0,
            ahead: status.ahead,
            behind: status.behind
        }
    }

    async getBranches(repoPath: string): Promise<Branch[]> {
        const branches = await git(repoPath).branch()
        return Object.values(branches.branches).map(b => ({
            name: b.name,
            isHead: b.current,
            isRemote: b.name.startsWith('remotes/')
        }))
    }

    async getCommits(repoPath: string, limit: number = 20): Promise<Commit[]> {
        const log = await git(repoPath).log({ maxCount: limit })
        return log.all.map(c => ({
            hash: c.hash,
            shortHash: c.hash.substring(0, 7),
            author: c.author_name,
            email: c.author_email,
            message: c.message,
            date: c.date
        }))
    }

    async checkoutBranch(repoPath: string, branch: string): Promise<void> {
        await git(repoPath).checkout(branch)
    }

    async createCommit(repoPath: string, message: string): Promise<any> {
        return git(repoPath).commit(message)
    }

    async push(repoPath: string, remote: string, branch: string): Promise<void> {
        await git(repoPath).push(remote, branch)
    }

    async pull(repoPath: string, remote: string, branch: string): Promise<void> {
        await git(repoPath).pull(remote, branch)
    }

    async getRemotes(repoPath: string): Promise<Remote[]> {
        const remotes = await git(repoPath).getRemotes(true)
        return remotes.map(r => ({
            name: r.name,
            url: r.refs.push || r.refs.fetch
        }))
    }

    async stageFile(repoPath: string, filePath: string): Promise<void> {
        await git(repoPath).add(filePath)
    }

    async unstageFile(repoPath: string, filePath: string): Promise<void> {
        await git(repoPath).reset(['HEAD', '--', filePath])
    }

    async stashList(repoPath: string): Promise<{ index: number; message: string }[]> {
        const result = await git(repoPath).stashList()
        return result.all.map((s, i) => ({ index: i, message: s.message }))
    }

    async stashPush(repoPath: string, message?: string): Promise<void> {
        const args = message ? ['push', '-m', message] : ['push']
        await git(repoPath).stash(args)
    }

    async stashPop(repoPath: string, index: number): Promise<void> {
        await git(repoPath).stash(['pop', `stash@{${index}}`])
    }

    async stashApply(repoPath: string, index: number): Promise<void> {
        await git(repoPath).stash(['apply', `stash@{${index}}`])
    }

    async stashDrop(repoPath: string, index: number): Promise<void> {
        await git(repoPath).stash(['drop', `stash@{${index}}`])
    }

    async discardFile(repoPath: string, filePath: string): Promise<void> {
        await git(repoPath).checkout(['--', filePath])
    }

    async getDiff(repoPath: string, args: string[] = []): Promise<string> {
        return git(repoPath).diff(args)
    }

    async getRepoStats(repoPath: string): Promise<{ totalCommits: number, workDays: number }> {
        try {
            const log = await git(repoPath).log()
            const dates = log.all.map(c => {
                const d = new Date(c.date)
                return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
            })
            return { totalCommits: log.total, workDays: new Set(dates).size }
        } catch {
            return { totalCommits: 0, workDays: 0 }
        }
    }
}

export const gitService = new GitService()
