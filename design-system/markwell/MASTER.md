# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** MarkWell
**Generated:** 2026-08-14 10:48:34
**Category:** Notes & Writing App

---

## Global Rules

### Color Palette — 「纸墨 Ink & Paper」（v2，2026-08-15 重制）

> v2 取代 v1（teal + orange 撞色被用户否决）。核心决策：
> **单一强调色**（墨蓝，链接心智零成本）+ error 红例外；**去纯白/纯灰**，
> 亮色为暖纸 + 暖墨，暗色为暖炭 + 暖白，两态同气质；正文级文字对比度
> 全部 ≥ 4.5:1、控件边框 ≥ 3:1（22 项脚本验证，明细见 `pages/color-scheme.html`）。

| Role（语义）  | Light     | Dark      | CSS Variable            | 说明（用途/对比度）                     |
| ------------- | --------- | --------- | ----------------------- | --------------------------------------- |
| Background    | `#FAF9F6` | `#211E1A` | `--color-bg`            | 纸面画布：暖纸白 / 暖炭夜读             |
| Foreground    | `#2A2720` | `#E8E4DA` | `--color-ink`           | 正文墨：暖黑 / 暖白（≥13:1）            |
| Surface       | `#F2F0EA` | `#26231F` | `--color-surface`       | 外壳/浮层底（与纸面分层）               |
| Surface Low   | `#EAE7DF` | `#2D2925` | `--color-surface-low`   | 悬停/次级浮层底                         |
| Muted         | `#6E6A5E` | `#A39E92` | `--color-ink-2`         | 次要文字（≥5.1:1）                      |
| Faint         | `#807A6D` | `#878173` | `--color-ink-3`         | 弱化/禁用/图标（≥3:1，不可作正文）      |
| Border        | `#E2DED3` | `#3B372F` | `--color-border`        | 装饰性分隔线（非交互控件）              |
| Border Strong | `#8F897A` | `#70695A` | `--color-border-strong` | 输入框/控件边界（≥3:1）                 |
| Primary       | `#1E4F8A` | `#8FB3DC` | `--color-primary`       | 墨蓝/雾蓝：链接、焦点环、选中（≥7.6:1） |
| Primary Soft  | `#E3EAF3` | `#2E3A4E` | `--color-primary-soft`  | 主色浅底（选中项背景）                  |
| On Primary    | `#FFFFFF` | `#1B3A5E` | `--color-on-primary`    | 主色底上的文字（≥5.3:1）                |
| Inline Code   | `#9E2B25` | `#E29A86` | `--color-code-text`     | 行内代码：枣红 / 暖珊瑚（≥7:1）         |
| Code Block    | `#F1EFE9` | `#26231F` | `--color-code-bg`       | 代码围栏底                              |
| Destructive   | `#C62828` | `#E06C5F` | `--color-error`         | 错误/危险（≥5.1:1）                     |
| Selection     | `#D3DFEE` | `#3A4A63` | `--color-selection`     | 文本选中底                              |
| Quote         | `#F5F3EE` | `#26231F` | `--color-quote-bg`      | 引用块底                                |

**Color Notes:** 上一版 teal+orange 撞色系整体废弃；强调色仅保留墨蓝一色（暗态映射雾蓝），
不再设独立 accent。暗色非中性灰：暖炭底带暖褐倾向，与亮色暖纸同属「纸墨」气质。

### Typography

- **Heading Font:** Inter
- **Body Font:** Inter
- **Mood:** minimal, clean, swiss, functional, neutral, professional
- **Google Fonts:** [Inter + Inter](https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap)

**CSS Import:**

```css
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap");
```

### Spacing Variables

| Token         | Value             | Usage                     |
| ------------- | ----------------- | ------------------------- |
| `--space-xs`  | `4px` / `0.25rem` | Tight gaps                |
| `--space-sm`  | `8px` / `0.5rem`  | Icon gaps, inline spacing |
| `--space-md`  | `16px` / `1rem`   | Standard padding          |
| `--space-lg`  | `24px` / `1.5rem` | Section padding           |
| `--space-xl`  | `32px` / `2rem`   | Large gaps                |
| `--space-2xl` | `48px` / `3rem`   | Section margins           |
| `--space-3xl` | `64px` / `4rem`   | Hero padding              |

### Shadow Depths

| Level         | Value                          | Usage                       |
| ------------- | ------------------------------ | --------------------------- |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)`   | Subtle lift                 |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)`    | Cards, buttons              |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)`  | Modals, dropdowns           |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: var(--color-primary);
  color: var(--color-on-primary);
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: var(--color-primary);
  border: 2px solid var(--color-primary);
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: var(--color-bg);
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: var(--color-primary);
  outline: none;
  box-shadow: 0 0 0 3px var(--color-primary-soft);
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: var(--color-bg);
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Minimalism & Swiss Style

**Keywords:** Clean, simple, spacious, functional, white space, high contrast, geometric, sans-serif, grid-based, essential

**Best For:** Enterprise apps, dashboards, documentation sites, SaaS platforms, professional tools

**Key Effects:** Subtle hover (200-250ms), smooth transitions, sharp shadows if any, clear type hierarchy, fast loading

### Page Pattern

**Pattern Name:** Newsletter / Content First

- **Conversion Strategy:** Single field form (Email only). Show 'Join X, 000 readers'. Read sample link.
- **CTA Placement:** Hero inline form + Sticky header form
- **Section Order:** 1. Hero (Value Prop + Form), 2. Recent Issues/Archives, 3. Social Proof (Subscriber count), 4. About Author

---

## Anti-Patterns (Do NOT Use)

- ❌ Excessive decoration
- ❌ Complex shadows
- ❌ 3D effects

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
