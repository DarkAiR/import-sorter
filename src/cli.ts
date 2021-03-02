import { existsSync, statSync } from 'fs';
import { resolve } from 'path';

import { ImportSorterCLI } from './import-sorter-cli';

const args = process.argv.slice(2);
if (args.length === 0) {
    process.exit(0);
}

const importSorterCLI = new ImportSorterCLI();
importSorterCLI.initialise();

args.map(async (url: string) => {
    const resolvedPath = resolve(url);
    if (existsSync(resolvedPath)) {
        if (statSync(resolvedPath).isDirectory()) {
            console.log(`${resolvedPath} is directory`);
            await importSorterCLI.sortImportsInDirectory(resolvedPath);
        } else if (statSync(resolvedPath).isFile()) {
            await importSorterCLI.sortImportsInFile(resolvedPath);
        }
    }
});
