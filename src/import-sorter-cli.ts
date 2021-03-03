import { exec } from 'child_process';
import { chain, merge, range as rangeLodash, defaultsDeep } from 'lodash';
import { resolve } from 'path';
import { EMPTY, from, of } from 'rxjs';
import { concatMap, map, mapTo } from 'rxjs/operators';
import { existsSync } from 'fs';
import { homedir } from 'os';

import {
    ConfigurationProvider,
    ImportRunner,
    ImportSorterConfiguration,
    InMemoryImportCreator,
    InMemoryImportSorter,
    SimpleImportAstParser,
    SimpleImportRunner,
    SortedImportData
} from './core/core-public';
import { readFile$, writeFile$ } from './core/helpers/io';

const nodePath = 'node';

export class CLIConfigurationProvider implements ConfigurationProvider {
    private currentConfiguration: ImportSorterConfiguration;

    public getConfiguration(): ImportSorterConfiguration {
        return this.currentConfiguration;
    }

    public async resetConfiguration(path: string) {
        this.currentConfiguration = await this._getConfiguration(path);
    }

    // Get default config,
    // extend it to be non-conflicting with prettier
    // extend it further with local vscode config to be in sync
    private async _getConfiguration(path: string): Promise<ImportSorterConfiguration> {
        const prettierConfig = await this._getPrettierConfiguration(path);
        const localConfig = await this._getLocalConfiguration(path);

        return defaultsDeep(
            {
                importStringConfiguration: {
                    quoteMark: prettierConfig.singleQuote ? 'single' : undefined,
                    tabSize: prettierConfig.tabWidth,
                    maximumNumberOfImportExpressionsPerLine: {
                        count: prettierConfig.printWidth
                    },
                    trailingComma: prettierConfig.trailingComma
                        ? prettierConfig.trailingComma
                        : undefined,
                    hasSemicolon:
                        typeof prettierConfig.semi !== 'undefined' ? prettierConfig.semi : undefined
                }
            },
            localConfig,
            this._getDefaultConfiguration()
        );
    }

    private _parseConfig(config: [{ string: string }]): Partial<ImportSorterConfiguration> {
        return Object.keys(config)
            .filter((key) => key.indexOf('importSorter.') === 0)
            .map((key) => {
                const total = {};
                const keys = key.split('.').filter((str) => str !== 'importSorter');
                keys.reduce((sum, currentKey, index) => {
                    if (index === keys.length - 1) {
                        sum[currentKey] =
                            typeof config[key].default !== 'undefined'
                                ? config[key].default
                                : config[key];
                    } else {
                        sum[currentKey] = {};
                    }
                    return sum[currentKey];
                }, total);
                return total;
            })
            .reduce((sum, currentObj) => merge(sum, currentObj), {}) as ImportSorterConfiguration;
    }

    private _getDefaultConfiguration(): ImportSorterConfiguration {
        const packageConfigPath = this._findPackageConfigPath();
        const fileConfigJsonObj = packageConfigPath
            ? require(this._findPackageConfigPath()).contributes.configuration.properties
            : {};
        const fileConfigMerged = this._parseConfig(fileConfigJsonObj);

        return {
            sortConfiguration: fileConfigMerged.sortConfiguration,
            importStringConfiguration: fileConfigMerged.importStringConfiguration,
            generalConfiguration: fileConfigMerged.generalConfiguration
        };
    }
    // find closest prettier config up to some level
    private async _getPrettierConfiguration(path: string) {
        const prettierCLIPath = await this._getPrettierPath(path);
        return prettierCLIPath
            ? new Promise((res, rej) => {
                  exec(
                      `${nodePath} ${prettierCLIPath} --find-config-path '${path}'`,
                      (error: any, stdout: string) => {
                          error ? rej(error) : res(resolve(stdout.trim()));
                      }
                  );
              })
                  .then((path: string) => {
                      return readFile$(path)
                          .pipe(map((content: string) => JSON.parse(content)))
                          .toPromise();
                  })
                  .catch((_) => {
                      return {};
                  })
            : {};
    }

    // check if vscode sorter config exists
    private async _getLocalConfiguration(
        path: string
    ): Promise<Partial<ImportSorterConfiguration>> {
        const homeDir = homedir();
        let depth = 1;
        let currentPath = resolve(path);
        let settingsPath: string;
        let exists = false;

        while (!exists && depth < 100 && currentPath !== homeDir) {
            settingsPath = resolve(currentPath, './.vscode/settings.json');
            exists = existsSync(settingsPath);
            currentPath = resolve(path, '../'.repeat(depth++));
        }

        return readFile$(settingsPath)
            .pipe(
                map((content: string) => {
                    // Remove comments from json
                    return this._parseConfig(JSON.parse(content.replace(/(\/\/.+\n)/g, '')));
                })
            )
            .toPromise()
            .catch((_) => {
                return {};
            });
    }

    // find closest to given path prettier installation
    private async _getPrettierPath(path: string): Promise<string | null> {
        const homeDir = homedir();
        let depth = 1;
        let currentPath = resolve(path);
        let prettierPath: string;
        let exists = false;

        while (!exists && depth < 100 && currentPath !== homeDir) {
            prettierPath = resolve(currentPath, './node_modules/.bin/prettier');
            exists = existsSync(prettierPath);
            currentPath = resolve(path, '../'.repeat(depth++));
        }
        return exists ? prettierPath : null;
    }

    private _findPackageConfigPath(): string | null {
        const homeDir = homedir();
        let depth = 1;
        let currentPath = __filename;
        let packagePath: string;
        let exists = false;

        while (!exists && depth < 100 && currentPath !== homeDir) {
            packagePath = resolve(currentPath, './package.json');
            exists = existsSync(packagePath);
            currentPath = resolve(__filename, '../'.repeat(depth++));
        }
        return exists ? packagePath : null;
    }
}

export class ImportSorterCLI {
    private importRunner: ImportRunner;
    private configurationProvider: CLIConfigurationProvider;
    public initialise() {
        this.configurationProvider = new CLIConfigurationProvider();
        this.importRunner = new SimpleImportRunner(
            new SimpleImportAstParser(),
            new InMemoryImportSorter(),
            new InMemoryImportCreator(),
            this.configurationProvider
        );
    }

    public sortImportsInFile(filePath: string): Thenable<void> {
        return from(this.configurationProvider.resetConfiguration(filePath))
            .pipe(concatMap(() => readFile$(filePath)))
            .pipe(
                concatMap((content) => {
                    const result: SortedImportData = this.importRunner.getSortImportData(
                        filePath,
                        content
                    );
                    if (result.isSortRequired) {
                        console.log(`${filePath} needs to be sorted, sorting...`);
                        return writeFile$(filePath, this.getFullSortedSourceFile(content, result))
                            .toPromise()
                            .then(() => {
                                console.log(`${filePath} saved`);
                            });
                    } else {
                        console.log(`${filePath} already sorted`);
                        return EMPTY;
                    }
                }),
                mapTo(void 0)
            )
            .toPromise()
            .catch(console.log);
    }

    public sortImportsInDirectory(dirPath: string): Thenable<void> {
        return from(this.configurationProvider.resetConfiguration(dirPath))
            .pipe(concatMap(() => this.importRunner.sortImportsInDirectory(dirPath)))
            .toPromise();
    }

    public getSortResultOfFile(filePath: string): Thenable<SortedImportData> {
        return from(this.configurationProvider.resetConfiguration(filePath))
            .pipe(concatMap(() => readFile$(filePath)))
            .pipe(
                concatMap((content) => {
                    const result: SortedImportData = this.importRunner.getSortImportData(
                        filePath,
                        content
                    );
                    return of(result);
                })
            )
            .toPromise();
    }

    private getFullSortedSourceFile(sourceText: string, sortedData: SortedImportData): string {
        let fileSourceArray = sourceText.split('\n');
        const linesToDelete = chain(
            sortedData.rangesToDelete.map((range) => rangeLodash(range.startLine, range.endLine))
        )
            .flatMap((ranges) => ranges)
            .value();

        for (let i = linesToDelete.length - 1; i >= 0; i--) {
            if (i === 0) {
                fileSourceArray.splice(linesToDelete[i], 1, sortedData.sortedImportsText);
            } else {
                fileSourceArray.splice(linesToDelete[i], 1);
            }
        }
        const sortedText = fileSourceArray.join('\n');
        return sortedText;
    }
}
