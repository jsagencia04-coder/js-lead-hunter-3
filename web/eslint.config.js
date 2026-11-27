import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import hooks from 'eslint-plugin-react-hooks'
export default tseslint.config(
 { ignores:['dist/**','node_modules/**','playwright-report/**','test-results/**'] },
 js.configs.recommended,
 ...tseslint.configs.recommended,
 { files:['**/*.{ts,tsx,js}'],plugins:{'react-hooks':hooks},linterOptions:{reportUnusedDisableDirectives:'off'},languageOptions:{globals:{window:'readonly',document:'readonly',navigator:'readonly',localStorage:'readonly',console:'readonly',setTimeout:'readonly',clearTimeout:'readonly',URL:'readonly',Blob:'readonly',fetch:'readonly',process:'readonly',__dirname:'readonly',React:'readonly',HTMLInputElement:'readonly',HTMLButtonElement:'readonly'}},
 rules:{'react-hooks/rules-of-hooks':'error','@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}],'no-undef':'off'} }
)
