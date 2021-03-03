import typescript from 'rollup-plugin-typescript';

export default {
    input: 'src/cli.ts',
    output: {
        file: 'dist/cli.js',
        format: 'cjs'
    },
    external: [
        'fs',
        'path',
        'child_process',
        'os',
        'lodash',
        'rxjs',
        'rxjs/operators',
        'typescript',
        'glob'
    ],
    plugins: [typescript()]
};
