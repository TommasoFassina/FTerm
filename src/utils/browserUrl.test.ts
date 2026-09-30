import { describe, it, expect } from 'vitest'
import { resolveBrowserInput, resolveSearchTemplate, buildSearchUrl, DEFAULT_SEARCH_TEMPLATE } from './browserUrl'

describe('resolveBrowserInput', () => {
  const ddg = DEFAULT_SEARCH_TEMPLATE

  it('returns undefined for empty input', () => {
    expect(resolveBrowserInput('', ddg)).toBeUndefined()
    expect(resolveBrowserInput('   ', ddg)).toBeUndefined()
  })

  it('passes through http(s) and about: URLs unchanged', () => {
    expect(resolveBrowserInput('https://example.com', ddg)).toBe('https://example.com')
    expect(resolveBrowserInput('http://example.com', ddg)).toBe('http://example.com')
    expect(resolveBrowserInput('about:blank', ddg)).toBe('about:blank')
  })

  it('adds https:// to bare domains', () => {
    expect(resolveBrowserInput('example.com', ddg)).toBe('https://example.com')
    expect(resolveBrowserInput('example.com/path', ddg)).toBe('https://example.com/path')
  })

  it('treats non-domain-looking text as a search query', () => {
    expect(resolveBrowserInput('hello world', ddg)).toBe('https://duckduckgo.com/?q=hello%20world')
  })
})

describe('resolveSearchTemplate', () => {
  it('resolves known engine ids', () => {
    expect(resolveSearchTemplate('google', undefined)).toContain('google.com')
    expect(resolveSearchTemplate('bing', undefined)).toContain('bing.com')
  })

  it('falls back to DuckDuckGo for unknown/undefined engine ids', () => {
    expect(resolveSearchTemplate(undefined, undefined)).toBe(DEFAULT_SEARCH_TEMPLATE)
    expect(resolveSearchTemplate('nonexistent', undefined)).toBe(DEFAULT_SEARCH_TEMPLATE)
  })

  it('uses the custom URL only when it contains %s', () => {
    expect(resolveSearchTemplate('custom', 'https://mysearch.com/?q=%s')).toBe('https://mysearch.com/?q=%s')
    expect(resolveSearchTemplate('custom', 'https://mysearch.com/no-placeholder')).toBe(DEFAULT_SEARCH_TEMPLATE)
    expect(resolveSearchTemplate('custom', undefined)).toBe(DEFAULT_SEARCH_TEMPLATE)
  })
})

describe('buildSearchUrl', () => {
  it('encodes the query into the template', () => {
    expect(buildSearchUrl('a b&c', 'https://x.com/?q=%s')).toBe('https://x.com/?q=a%20b%26c')
  })
})
