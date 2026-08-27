import { FlatCompat } from "@eslint/eslintrc";

// `next lint` (deprecated but still what "lint" runs) needs some eslint
// config to exist or it prompts interactively to create one - which
// fails outright in any non-interactive environment (CI, this repo's
// own `pnpm lint`). FlatCompat is Next's own documented bridge for using
// its legacy shareable configs under ESLint 9's flat config format.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [...compat.extends("next/core-web-vitals", "next/typescript")];

export default eslintConfig;
