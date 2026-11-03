# CLC Kernel — Official Website & Landing Page

Official static website and documentation landing page for **CLC Kernel**, built with **Astro 5**, **Tailwind CSS v4**, and native internationalization (**i18n**).

---

## 🚀 Quickstart & Local Development

### Prerequisites
- Node.js `>= 18.0.0`
- npm `>= 9.0.0`

### 1. From the Repository Root
You can run website tasks directly from the monorepo root:

```bash
# Start local development server (http://localhost:4321)
npm run website:dev

# Build production static bundle (outputs to website/dist/)
npm run website:build
```

### 2. From the `website/` Subdirectory
Alternatively, navigate into the `website/` directory:

```bash
cd website

# Install dependencies
npm install

# Start Astro dev server
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview
```

---

## 📁 Project Structure

```text
website/
├── astro.config.mjs         # Astro configuration with i18n routing (en/es)
├── package.json             # Website dependencies (Astro, Tailwind v4, three, gsap)
├── public/                  # Static assets, CNAME, sitemap.xml, robots.txt, apple-touch-icon.png, images/brand/ (logo, favicons, og.jpg)
└── src/
    ├── components/
    │   ├── CommandCopy.astro        # Install command with copy-to-clipboard button
    │   ├── HarnessFileTree.astro    # Interactive anatomy of a governed repository
    │   ├── LoopSection.astro        # The six-step loop (technical page)
    │   ├── QuickstartSection.astro  # Real install output, Next steps and commands
    │   ├── home/                    # Home: hero + 3D figure, statement, steps, audience, CTA
    │   └── tech/                    # How it works: why, guards, stacks, files, limits, glossary
    ├── i18n/ui.js           # Shared strings and links (EN & ES)
    ├── layouts/Layout.astro # Meta tags, hreflang, fonts, nav, footer
    ├── pages/
    │   ├── index.astro, how-it-works.astro, docs.astro      # English
    │   └── es/index.astro, es/how-it-works.astro, es/docs.astro
    ├── scripts/
    │   ├── home.js          # GSAP hero entrance, word reveal, lazy 3D loader
    │   ├── gate-scene.js    # three.js "Fig. 01" scene (dynamic import)
    │   └── copy.js          # Clipboard helper for [data-copy] buttons
    └── styles/global.css    # Tailwind v4 theme tokens (ink, paper, signal accent)
```

---

## 🌐 Internationalization (i18n)

The website natively supports English (`en`) and Spanish (`es`).

- **English (Default)**: Served at `/`
- **Spanish**: Served at `/es`
- **Technical page**: `/how-it-works` and `/es/how-it-works`

### Adding or Updating Translations
All UI strings are centralized in [`src/i18n/ui.js`](src/i18n/ui.js). When adding new UI copy:
1. Add the keys to both `ui.en` and `ui.es`.
2. Access the translation dictionary inside your Astro component via `import { ui } from '../i18n/ui.js'`.

---

## 🚢 Deployment (Netlify)

The website is configured to deploy automatically to **Netlify** via `netlify.toml` in the repository root:

- **Base directory**: `website`
- **Build command**: `npm run build`
- **Publish directory**: `dist` (relative to base -> `website/dist`)
- **Custom domain**: `clckernel.carlosleoncode.com`

---

## 📄 License
MIT © [Carlos Leon Code](https://github.com/carlosleoncode)
