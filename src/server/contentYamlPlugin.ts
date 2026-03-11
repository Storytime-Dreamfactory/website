import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))

/**
 * Vite dev-server middleware that serves YAML files from the `content/`
 * directory at the `/content/` URL prefix. This eliminates the need to
 * mirror YAML files into `public/content/`.
 *
 * Images and other static assets still live in `public/content/` and are
 * served by Vite's built-in static file handling.
 */
export function contentYamlPlugin(): Plugin {
  return {
    name: 'content-yaml-serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url
        if (!url || !url.startsWith('/content/') || !/\.ya?ml$/i.test(url)) {
          return next()
        }

        const filePath = path.resolve(workspaceRoot, url.slice(1))

        if (!filePath.startsWith(path.resolve(workspaceRoot, 'content'))) {
          return next()
        }

        try {
          const content = await readFile(filePath, 'utf8')
          res.setHeader('Content-Type', 'text/yaml; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache')
          res.end(content)
        } catch {
          next()
        }
      })
    },
  }
}
