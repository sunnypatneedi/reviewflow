// Flat ESLint config: ban raw Tailwind colours / opacity / z / shadow / font-size
// in class strings. See IMPLEMENTATION.md §5b.
//
// Exception: src/components/interior/** is ignored — vendored Interior demo styles
// keep their stone/raw chrome; review surfaces must not import their rendered JSX.
import tseslint from "typescript-eslint";

// Palette / arbitrary colour utilities (optional variant prefixes).
const COLOR = String.raw`(?:^|\s)(?:[a-z-]+:)*(?:bg|text|border|ring|fill|stroke|outline|decoration|shadow|from|to|via|divide|placeholder|caret|accent)-(?:\[(?:#|rgb|hsl|oklch|color-mix)|(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d+)?(?:\s|$))`;

// Raw opacity/z/shadow/font-size. Opacity is banned unless preceded by a
// disabled-state prefix (disabled: / aria-disabled: / peer-disabled: /
// data-disabled / data-[disabled…] / has-[:disabled]).
const OPACITY = String.raw`(?:^|\s)(?!(?:(?:[a-z-]+:)*(?:disabled|aria-disabled|peer-disabled|data-disabled)|(?:[a-z-]+:)*data-\[disabled(?:=[^\]]*)?\]|(?:[a-z-]+:)*has-\[:disabled\])[:\]])(?:(?:[a-z-]+|data-\[[^\]]+\]|aria-\[[^\]]+\]|group(?:\/[a-z-]+)?|peer(?:\/[a-z-]+)?|has-\[[^\]]+\]):)*opacity-\d+`;
const OTHER = String.raw`(?:^|\s)(?:z-\d+|shadow-(?:sm|md|lg|xl|2xl)|text-\[\d)`;

const RAW = `${COLOR}|${OPACITY}|${OTHER}`;

export default tseslint.config(
  {
    ignores: [
      // Vendored Interior demo styles (stone/raw chrome). Do not restyle here;
      // review must use role tokens or a thin local wrapper instead.
      "src/components/interior/**",
    ],
  },
  {
    files: ["src/**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    linterOptions: {
      // Pre-existing disable comments may reference plugins we do not load.
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `Literal[value=/${RAW}/]`,
          message:
            "Use role tokens (bg-fill-subtle, text-text-muted …), not raw colours/opacity/z/shadow.",
        },
        {
          selector: `TemplateElement[value.raw=/${RAW}/]`,
          message: "Use role tokens, not raw values.",
        },
        {
          selector:
            "JSXAttribute[name.name='style'] Property[key.name=/^(color|background|backgroundColor|borderColor|zIndex|opacity|boxShadow)$/] > Literal",
          message: "No raw values in style props.",
        },
      ],
    },
  },
);
