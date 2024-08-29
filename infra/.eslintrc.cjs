module.exports = {
    overrides: [{
        files: ['**/*.ts', '**/*.tsx'],
        extends: ['plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'],
        rules: {
            '@typescript-eslint/no-unused-vars': 'error',
            '@typescript-eslint/explicit-function-return-type': 'error',
        },
        parser: '@typescript-eslint/parser'
    }]
}
