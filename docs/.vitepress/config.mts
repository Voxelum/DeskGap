import { defineConfig } from 'vitepress';

export default defineConfig({
    title: 'DeskGap',
    description: 'A cross-platform desktop app framework powered by Node.js and the operating system webview.',
    srcDir: 'api',
    outDir: 'site',
    cleanUrls: true,
    themeConfig: {
        nav: [
            { text: 'Guide', link: '/' },
            { text: 'API', link: '/api' },
            { text: 'GitHub', link: 'https://github.com/patr0nus/DeskGap' }
        ],
        sidebar: [
            { text: 'Introduction', link: '/' },
            { text: 'API Reference', link: '/api' },
            { text: 'Architecture', link: '/architecture' },
            { text: 'Building', link: '/building' },
            { text: 'Developer Tools', link: '/devtools' },
            { text: 'Electron Compatibility', link: '/electron-compatibility' },
            { text: 'Changelog', link: '/changelog' }
        ],
        socialLinks: [
            { icon: 'github', link: 'https://github.com/patr0nus/DeskGap' }
        ],
        search: {
            provider: 'local'
        }
    }
});