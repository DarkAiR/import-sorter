'use strict';

var fs = require('fs');
var path = require('path');
var child_process = require('child_process');
var lodash = require('lodash');
var rxjs = require('rxjs');
var operators = require('rxjs/operators');
var os = require('os');
var ts = require('typescript');
var glob = require('glob');

function _interopNamespace(e) {
    if (e && e.__esModule) return e;
    var n = Object.create(null);
    if (e) {
        Object.keys(e).forEach(function (k) {
            if (k !== 'default') {
                var d = Object.getOwnPropertyDescriptor(e, k);
                Object.defineProperty(n, k, d.get ? d : {
                    enumerable: true,
                    get: function () {
                        return e[k];
                    }
                });
            }
        });
    }
    n['default'] = e;
    return Object.freeze(n);
}

var glob__namespace = /*#__PURE__*/_interopNamespace(glob);

/*! *****************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */

function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

class LineRange {
    constructor(json) {
        Object.assign(this, json);
    }
    isLineIntersecting(range) {
        //line comparison
        const min = this.startLine < range.startLine ? this : range;
        const max = min === this ? range : this;
        //lines do not intersect
        if (min.endLine < max.startLine) {
            return false;
        }
        return true;
    }
    union(range) {
        const min = this.startLine < range.startLine ? this : range;
        const max = min === this ? range : this;
        return new LineRange({
            startLine: min.startLine,
            startCharacter: min.startCharacter,
            endLine: max.endLine,
            endCharacter: max.endCharacter
        });
    }
}

function readFile$(filePath, encoding = 'utf-8') {
    return rxjs.Observable.create((observer) => {
        fs.readFile(filePath, encoding, (error, data) => {
            if (error) {
                observer.error(error);
            }
            else {
                observer.next(data);
                observer.complete();
            }
        });
    });
}
function writeFile$(filePath, data) {
    return rxjs.Observable.create((observer) => {
        fs.writeFile(filePath, data, (error) => {
            if (error) {
                observer.error(error);
            }
            else {
                observer.next(void 0);
                observer.complete();
            }
        });
    });
}
function getFullPath(srcPath, filename) {
    return path.join(srcPath, filename);
}
function filePaths$(startingSourcePath, pattern, ignore) {
    return rxjs.Observable.create((observer) => {
        glob__namespace(pattern, {
            cwd: startingSourcePath,
            ignore,
            nodir: true
        }, (error, matches) => {
            if (error) {
                observer.error(error);
            }
            else {
                const fullPaths = matches.map(filePath => getFullPath(startingSourcePath, filePath));
                observer.next(fullPaths);
                observer.complete();
            }
        });
    });
}

function getPositionByOffset(offset, text) {
    const before = text.slice(0, offset);
    const newLines = before.match(/\n/g);
    const line = newLines ? newLines.length : 0;
    const preCharacters = before.match(/(\n|^).*$/g);
    let character = 0;
    if (line !== 0) {
        character = preCharacters && preCharacters[0].length ? preCharacters[0].length - 1 : 0;
    }
    else {
        character = preCharacters ? preCharacters[0].length : 0;
    }
    return {
        line,
        character
    };
}

class SimpleImportAstParser {
    parseImports(fullFilePath, _sourceText) {
        if (_sourceText !== null && _sourceText !== undefined && _sourceText.trim() === '') {
            return { importElements: [], usedTypeReferences: [], firstImportLineNumber: null };
        }
        const sourceText = _sourceText || fs.readFileSync(fullFilePath).toString();
        const sourceFile = this.createSourceFile(fullFilePath, sourceText);
        const importsAndTypes = this.delintImportsAndTypes(sourceFile, sourceText);
        this.updateFirstNodeLeadingComments(importsAndTypes.importNodes, sourceText);
        return {
            importElements: importsAndTypes.importNodes.map(x => this.parseImport(x, sourceFile)).filter(x => x !== null),
            usedTypeReferences: importsAndTypes.usedTypeReferences,
            firstImportLineNumber: this.firstImportLineNumber(importsAndTypes.importNodes[0], sourceText)
        };
    }
    updateFirstNodeLeadingComments(importNodes, text) {
        const firstNode = importNodes[0];
        if (!firstNode) {
            return;
        }
        if (!firstNode.importComment.leadingComments.length) {
            return;
        }
        const lastLeadingComment = this.getLastLeadingComment(firstNode);
        const leadingCommentNextLine = getPositionByOffset(lastLeadingComment.range.end, text).line + 1;
        if (firstNode.start.line - leadingCommentNextLine >= 1) {
            //if we have leading comments, and there is at least one line which separates them from import, then we do not consider it
            //to be a leading comment belonging to node
            firstNode.importComment.leadingComments = [];
        }
        else {
            //if we have leading comments then only take the last one;
            firstNode.importComment.leadingComments = [lastLeadingComment];
        }
    }
    firstImportLineNumber(importNode, text) {
        if (!importNode) {
            return null;
        }
        const leadingComments = this.getLastLeadingComment(importNode);
        if (leadingComments) {
            return getPositionByOffset(leadingComments.range.pos, text).line;
        }
        return importNode.start.line;
    }
    getLastLeadingComment(importNode) {
        if (!importNode) {
            return null;
        }
        return importNode.importComment.leadingComments && importNode.importComment.leadingComments.length ?
            importNode.importComment.leadingComments[importNode.importComment.leadingComments.length - 1] : null;
    }
    createSourceFile(fullFilePath, sourceText) {
        return ts.createSourceFile(fullFilePath, sourceText, ts.ScriptTarget.Latest, false);
    }
    delintImportsAndTypes(sourceFile, sourceText) {
        const importNodes = [];
        const usedTypeReferences = [];
        const sourceFileText = sourceText || sourceFile.getText();
        const delintNode = (node) => {
            let isSkipChildNode = false;
            switch (node.kind) {
                case ts.SyntaxKind.ImportDeclaration:
                    const lines = this.getCodeLineNumbers(node, sourceFile);
                    importNodes.push({
                        importDeclaration: node,
                        start: lines.importStartLine,
                        end: lines.importEndLine,
                        importComment: this.getComments(sourceFileText, node)
                    });
                    this.getCodeLineNumbers(node, sourceFile);
                    //if we get import declaration then we do not want to do further delinting on the children of the node
                    isSkipChildNode = true;
                    break;
                case ts.SyntaxKind.Identifier:
                    //adding all identifiers(except from the ImportDeclarations). This is quite verbose, but seems to do the trick.
                    usedTypeReferences.push(node.getText(sourceFile));
                    break;
            }
            if (!isSkipChildNode) {
                ts.forEachChild(node, delintNode);
            }
        };
        delintNode(sourceFile);
        return { importNodes, usedTypeReferences };
    }
    getComments(sourceFileText, node) {
        const leadingComments = (ts.getLeadingCommentRanges(sourceFileText, node.getFullStart()) || [])
            .map(range => this.getComment(range, sourceFileText));
        const trailingComments = (ts.getTrailingCommentRanges(sourceFileText, node.getEnd()) || [])
            .map(range => this.getComment(range, sourceFileText));
        return { leadingComments, trailingComments };
    }
    getComment(range, sourceFileText) {
        const text = sourceFileText.slice(range.pos, range.end).replace(/\r/g, '');
        const comment = {
            range,
            text,
            isTripleSlashDirective: text.match(/\/\/\/\s?</g) != null
        };
        return comment;
    }
    getCodeLineNumbers(node, sourceFile) {
        const importStartLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const importEndLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        return { importStartLine: importStartLine, importEndLine: importEndLine };
    }
    parseImport(importNode, sourceFile) {
        const moduleSpecifierName = importNode.importDeclaration.moduleSpecifier.kind === ts.SyntaxKind.StringLiteral
            ? importNode.importDeclaration.moduleSpecifier.text
            : importNode.importDeclaration.moduleSpecifier.getFullText(sourceFile).trim();
        const result = {
            moduleSpecifierName: moduleSpecifierName,
            startPosition: importNode.start,
            endPosition: importNode.end,
            hasFromKeyWord: false,
            namedBindings: [],
            importComment: importNode.importComment
        };
        const importClause = importNode.importDeclaration.importClause;
        if (!importClause) {
            return result;
        }
        if (importClause.name) {
            result.hasFromKeyWord = true;
            result.defaultImportName = importClause.name.text;
        }
        if (!importClause.namedBindings) {
            return result;
        }
        result.hasFromKeyWord = true;
        if (importClause.namedBindings.kind === ts.SyntaxKind.NamespaceImport) {
            const nsImport = importClause.namedBindings;
            result.namedBindings.push({ aliasName: nsImport.name.text, name: '*' });
            return result;
        }
        if (importClause.namedBindings.kind === ts.SyntaxKind.NamedImports) {
            const nImport = importClause.namedBindings;
            nImport.elements.forEach(y => {
                const propertyName = y.propertyName ? y.propertyName.text : y.name.text;
                const aliasName = !y.propertyName ? null : y.name.text;
                result.namedBindings.push({ aliasName: aliasName, name: propertyName });
            });
            return result;
        }
        console.warn('unsupported import: ', JSON.stringify(importClause));
        return null;
    }
}

class InMemoryImportCreator {
    initialise(importStringConfig) {
        this.importStringConfig = importStringConfig;
    }
    createImportText(groups) {
        this.assertIsInitialised();
        const importLines = [];
        groups
            .forEach((x, i, data) => {
            const importStrings = this.createImportStrings(x.elements);
            const line = importStrings.imports.join('\n') +
                this.repeatString('\n', i !== data.length - 1 ? x.numberOfEmptyLinesAfterGroup : 0);
            importLines.push(line);
            importLines.unshift(...importStrings.tripleSlashDirectives);
        });
        return importLines.join('\n') + this.repeatString('\n', this.importStringConfig.numberOfEmptyLinesAfterAllImports);
    }
    createImportStrings(element) {
        this.assertIsInitialised();
        const tripleSlashDirectives = [];
        const imports = element.map(x => {
            const importString = this.createSingleImportString(x);
            const leadingComments = [];
            x.importComment.leadingComments.forEach(comment => {
                if (!comment.isTripleSlashDirective) {
                    leadingComments.push(comment.text);
                }
                else {
                    tripleSlashDirectives.push(comment.text);
                }
            });
            let leadingCommentText = leadingComments.join('\n');
            leadingCommentText = leadingCommentText ? leadingCommentText + '\n' : leadingCommentText;
            const trailingComments = [];
            x.importComment.trailingComments.forEach(comment => {
                if (!comment.isTripleSlashDirective) {
                    trailingComments.push(comment.text);
                }
                else {
                    tripleSlashDirectives.push(comment.text);
                }
            });
            let trailingCommentText = trailingComments.join('\n');
            trailingCommentText = trailingCommentText ? ' ' + trailingCommentText : trailingCommentText;
            const importWithComments = leadingCommentText + importString + trailingCommentText;
            return importWithComments;
        });
        return ({ imports, tripleSlashDirectives });
    }
    assertIsInitialised() {
        if (!this.importStringConfig) {
            throw new Error('ImportStringConfiguration: has not been initialised');
        }
    }
    createSingleImportString(element) {
        const qMark = this.getQuoteMark();
        if (!element.hasFromKeyWord) {
            return `import ${qMark}${element.moduleSpecifierName}${qMark}${this.semicolonChar}`;
        }
        if (element.namedBindings && element.namedBindings.length > 0) {
            const isStarImport = element.namedBindings.some(x => x.name === '*');
            if (isStarImport) {
                return this.createStarImport(element);
            }
            const curlyBracketElement = this.createCurlyBracketElement(element);
            return this.createImportWithCurlyBracket(element, curlyBracketElement.line, curlyBracketElement.isSingleLine);
        }
        if (element.defaultImportName) {
            return `import ${element.defaultImportName} from ${qMark}${element.moduleSpecifierName}${qMark}${this.semicolonChar}`;
        }
        else {
            return `import {} from ${qMark}${element.moduleSpecifierName}${qMark}${this.semicolonChar}`;
        }
    }
    createStarImport(element) {
        const qMark = this.getQuoteMark();
        const spaceConfig = this.getSpaceConfig();
        if (element.defaultImportName) {
            // tslint:disable-next-line:max-line-length
            return `import ${element.defaultImportName}${spaceConfig.beforeComma},${spaceConfig.afterComma}${element.namedBindings[0].name} as ${element.namedBindings[0].aliasName} from ${qMark}${element.moduleSpecifierName}${qMark}${this.semicolonChar}`;
        }
        else {
            return `import ${element.namedBindings[0].name} as ${element.namedBindings[0].aliasName} from ${qMark}${element.moduleSpecifierName}${qMark}${this.semicolonChar}`;
        }
    }
    createCurlyBracketElement(element) {
        const spaceConfig = this.getSpaceConfig();
        const nameBindingStringsExpr = lodash.chain(element.namedBindings).map(x => (x.aliasName ? `${x.name} as ${x.aliasName}` : x.name));
        const resultingChunks = this.createNameBindingChunks(nameBindingStringsExpr, element);
        return resultingChunks.isSingleLine
            ? { line: `${resultingChunks.nameBindings[0]}`, isSingleLine: true }
            : {
                line: `${spaceConfig.tabSequence}${resultingChunks.nameBindings.join(`,\n${spaceConfig.tabSequence}`)}`,
                isSingleLine: false
            };
    }
    createNameBindingChunks(nameBindingStringsExpr, element) {
        const nameBindings = nameBindingStringsExpr.value();
        if (this.importStringConfig.maximumNumberOfImportExpressionsPerLine.type === 'words') {
            return this.createNameBindingChunksByWords(nameBindings, this.importStringConfig.maximumNumberOfImportExpressionsPerLine.count);
        }
        return this.createNameBindingChunksByLength(nameBindings, element);
    }
    createNameBindingChunksByWords(nameBindings, maximumNumberOfWordsBeforeBreak) {
        const spaceConfig = this.getSpaceConfig();
        const beforeCommaAndAfterPart = `${spaceConfig.beforeComma},${spaceConfig.afterComma}`;
        const nameBindingsResult = lodash.chain(nameBindings)
            .chunk(maximumNumberOfWordsBeforeBreak || 1)
            .map(x => x.join(beforeCommaAndAfterPart))
            .value();
        const isSingleLine = nameBindings.length <= maximumNumberOfWordsBeforeBreak;
        this.appendTrailingComma(nameBindingsResult, isSingleLine);
        return {
            nameBindings: nameBindingsResult,
            isSingleLine
        };
    }
    createNameBindingChunksByLength(nameBindings, element) {
        const max = this.importStringConfig.maximumNumberOfImportExpressionsPerLine.count;
        const spaceConfig = this.getSpaceConfig();
        const beforeCommaAndAfterPart = `${spaceConfig.beforeComma},${spaceConfig.afterComma}`;
        const insideCurlyString = nameBindings.join(beforeCommaAndAfterPart);
        const singleLineImport = this.createImportWithCurlyBracket(element, insideCurlyString, true);
        const isSingleLine = this.importStringConfig.trailingComma === 'always'
            ? singleLineImport.length < max
            : singleLineImport.length <= max;
        if (isSingleLine) {
            const nameBindingsResult = [insideCurlyString];
            this.appendTrailingComma(nameBindingsResult, true);
            return {
                nameBindings: nameBindingsResult,
                isSingleLine: true
            };
        }
        if (this.importStringConfig.maximumNumberOfImportExpressionsPerLine.type ===
            'newLineEachExpressionAfterCountLimit') {
            return this.createNameBindingChunksByWords(nameBindings, 0);
        }
        if (this.importStringConfig.maximumNumberOfImportExpressionsPerLine.type ===
            'newLineEachExpressionAfterCountLimitExceptIfOnlyOne') {
            if (nameBindings.length <= 1) {
                return this.createNameBindingChunksByWords(nameBindings, 2);
            }
            else {
                return this.createNameBindingChunksByWords(nameBindings, 0);
            }
        }
        const result = [];
        let resultIndex = 0;
        let currentTotalLength = 0;
        const maxLineLength = max - this.importStringConfig.tabSize;
        this.appendTrailingComma(nameBindings, false);
        nameBindings.forEach((x, ind) => {
            const isLastNameBinding = ind === nameBindings.length - 1;
            const xLength = isLastNameBinding
                ? x.length //last element, so we remove comma and space before comma
                : x.length + this.importStringConfig.spacingPerImportExpression.beforeComma + 1; // 1 for comma
            //if we have first element in chunk then we need to consider after comma spaces
            currentTotalLength = result[resultIndex]
                ? xLength + currentTotalLength + this.importStringConfig.spacingPerImportExpression.afterComma
                : xLength + currentTotalLength;
            if (currentTotalLength <= maxLineLength) {
                result[resultIndex] ? result[resultIndex].push(x) : (result[resultIndex] = [x]);
                return;
            }
            else {
                resultIndex = result[resultIndex] ? resultIndex + 1 : resultIndex;
                result[resultIndex] = [x];
                if (xLength < maxLineLength) {
                    currentTotalLength = xLength;
                }
                else {
                    currentTotalLength = 0;
                    resultIndex++;
                }
            }
        });
        return {
            nameBindings: result.map(x => x.join(beforeCommaAndAfterPart)),
            isSingleLine: false
        };
    }
    appendTrailingComma(nameBindings, isSingleLine) {
        const hasTrailingComma = (isSingleLine && this.importStringConfig.trailingComma === 'always') ||
            (!isSingleLine && this.importStringConfig.trailingComma !== 'none');
        if (hasTrailingComma) {
            nameBindings[nameBindings.length - 1] =
                nameBindings[nameBindings.length - 1] + `${this.getSpaceConfig().beforeComma},`;
        }
    }
    createImportWithCurlyBracket(element, namedBindingString, isSingleLine) {
        const qMark = this.getQuoteMark();
        const spaceConfig = this.getSpaceConfig();
        if (element.defaultImportName) {
            return isSingleLine
                ? // tslint:disable-next-line:max-line-length
                    `import ${element.defaultImportName}${spaceConfig.beforeComma},${spaceConfig.afterComma}{${spaceConfig.afterStartingBracket}${namedBindingString}${spaceConfig.beforeEndingBracket}} from ${qMark}${element.moduleSpecifierName}${qMark}${this.semicolonChar}`
                : // tslint:disable-next-line:max-line-length
                    `import ${element.defaultImportName}${spaceConfig.beforeComma},${spaceConfig.afterComma}{\n${namedBindingString}\n} from ${qMark}${element.moduleSpecifierName}${qMark}${this.semicolonChar}`;
        }
        return isSingleLine
            ? // tslint:disable-next-line:max-line-length
                `import {${spaceConfig.afterStartingBracket}${namedBindingString}${spaceConfig.beforeEndingBracket}} from ${qMark}${element.moduleSpecifierName}${qMark}${this.semicolonChar}`
            : `import {\n${namedBindingString}\n} from ${qMark}${element.moduleSpecifierName}${qMark}${this.semicolonChar}`;
    }
    getSpaceConfig() {
        const tabSequence = this.importStringConfig.tabType === 'tab'
            ? this.repeatString('\t', 1)
            : this.repeatString(' ', this.importStringConfig.tabSize);
        return {
            beforeComma: this.repeatString(' ', this.importStringConfig.spacingPerImportExpression.beforeComma),
            afterComma: this.repeatString(' ', this.importStringConfig.spacingPerImportExpression.afterComma),
            afterStartingBracket: this.repeatString(' ', this.importStringConfig.spacingPerImportExpression.afterStartingBracket),
            beforeEndingBracket: this.repeatString(' ', this.importStringConfig.spacingPerImportExpression.beforeEndingBracket),
            tabSequence: tabSequence
        };
    }
    getQuoteMark() {
        return this.importStringConfig.quoteMark === 'single' ? "'" : '"';
    }
    get semicolonChar() {
        return this.importStringConfig.hasSemicolon === true ? ';' : '';
    }
    repeatString(str, numberOfTimes) {
        return Array.apply(null, Array(numberOfTimes + 1)).join(str);
    }
}

const NEW_PERIOD_CHAR = String.fromCharCode(128);
class InMemoryImportSorter {
    initialise(sortConfig) {
        this.sortConfig = sortConfig;
    }
    sortImportElements(imports) {
        this.assertIsInitialised();
        const clonedElements = lodash.cloneDeep(imports);
        const joinedImportsResult = this.joinImportPaths(clonedElements);
        const duplicates = joinedImportsResult.duplicates;
        const sortedImportsExpr = this.sortNamedBindings(joinedImportsResult.joinedExpr);
        const sortedElementGroups = this.applyCustomSortingRules(sortedImportsExpr);
        this.sortModuleSpecifiers(sortedElementGroups);
        return {
            groups: sortedElementGroups,
            duplicates: duplicates
        };
    }
    assertIsInitialised() {
        if (!this.sortConfig) {
            throw new Error('SortConfiguration: has not been initialised');
        }
    }
    normalizePaths(imports) {
        return lodash.chain(imports).map(x => {
            const isRelativePath = x.moduleSpecifierName.startsWith(`.`)
                || x.moduleSpecifierName.startsWith(`..`);
            x.moduleSpecifierName = isRelativePath ? path.normalize(x.moduleSpecifierName).replace(new RegExp('\\' + path.sep, 'g'), '/') : x.moduleSpecifierName;
            if (isRelativePath && !x.moduleSpecifierName.startsWith(`./`) && !x.moduleSpecifierName.startsWith(`../`)) {
                if (x.moduleSpecifierName === '.') {
                    x.moduleSpecifierName = './';
                }
                else if (x.moduleSpecifierName === '..') {
                    x.moduleSpecifierName = '../';
                }
                else {
                    x.moduleSpecifierName = `./${x.moduleSpecifierName}`;
                }
            }
            return x;
        });
    }
    sortNamedBindings(importsExpr) {
        const sortOrder = this.getSortOrderFunc(this.sortConfig.importMembers.order);
        return importsExpr.map(x => {
            if (x.namedBindings && x.namedBindings.length) {
                x.namedBindings =
                    lodash.chain(x.namedBindings)
                        .orderBy((y) => sortOrder(y.name), [this.sortConfig.importMembers.direction])
                        .value();
                return x;
            }
            return x;
        });
    }
    sortModuleSpecifiers(elementGroups) {
        const sortOrder = this.getSortOrderFunc(this.sortConfig.importPaths.order, true);
        elementGroups.filter(gr => !gr.customOrderRule.disableSort).forEach(gr => {
            gr.elements = lodash.chain(gr.elements)
                .orderBy(y => sortOrder(y.moduleSpecifierName), [this.sortConfig.importPaths.direction])
                .value();
        });
    }
    joinImportPaths(imports) {
        const normalizedPathsExpr = this.normalizePaths(imports);
        if (!this.sortConfig.joinImportPaths) {
            return {
                joinedExpr: normalizedPathsExpr,
                duplicates: []
            };
        }
        const duplicates = [];
        const joined = normalizedPathsExpr
            .groupBy(x => x.moduleSpecifierName)
            .map((x) => {
            if (x.length > 1) {
                //removing duplicates by module specifiers
                const nameBindings = lodash.chain(x).flatMap(y => y.namedBindings).uniqBy(y => y.name).value();
                const defaultImportElement = x.find(y => !lodash.isNil(y.defaultImportName) && !(y.defaultImportName.trim() === ''));
                const defaultImportName = defaultImportElement ? defaultImportElement.defaultImportName : null;
                x[0].defaultImportName = defaultImportName;
                x[0].namedBindings = nameBindings;
                duplicates.push(...x.slice(1));
                return x[0];
            }
            else {
                //removing duplicate name bindings
                const nameBindings = lodash.chain(x).flatMap(y => y.namedBindings).uniqBy(y => y.name).value();
                x[0].namedBindings = nameBindings;
            }
            return x[0];
        })
            .value();
        return {
            joinedExpr: lodash.chain(joined),
            duplicates: duplicates
        };
    }
    getDefaultLineNumber() {
        if (this.sortConfig.customOrderingRules
            && this.sortConfig.customOrderingRules.defaultNumberOfEmptyLinesAfterGroup) {
            return this.sortConfig.customOrderingRules.defaultNumberOfEmptyLinesAfterGroup;
        }
        return 0;
    }
    applyCustomSortingRules(sortedImports) {
        if (!this.sortConfig.customOrderingRules
            || !this.sortConfig.customOrderingRules.rules
            || this.sortConfig.customOrderingRules.rules.length === 0) {
            const customRules = this.sortConfig.customOrderingRules;
            return [{
                    elements: sortedImports.value(),
                    numberOfEmptyLinesAfterGroup: this.getDefaultLineNumber(),
                    customOrderRule: {
                        disableSort: customRules ? customRules.disableDefaultOrderSort : false,
                        numberOfEmptyLinesAfterGroup: customRules ? customRules.defaultNumberOfEmptyLinesAfterGroup : null,
                        orderLevel: customRules ? customRules.defaultOrderLevel : null,
                        regex: null
                    }
                }];
        }
        const rules = this.sortConfig
            .customOrderingRules
            .rules
            .map(x => ({
            orderLevel: x.orderLevel,
            regex: x.regex,
            type: x.type,
            disableSort: x.disableSort,
            numberOfEmptyLinesAfterGroup: lodash.isNil(x.numberOfEmptyLinesAfterGroup) ? this.getDefaultLineNumber() : x.numberOfEmptyLinesAfterGroup
        }));
        const result = {};
        sortedImports
            .forEach(x => {
            const rule = rules.find(e => !e.type || e.type === 'path' ? x.moduleSpecifierName.match(e.regex) !== null : this.matchNameBindings(x, e.regex));
            if (!rule) {
                this.addElement(result, {
                    disableSort: this.sortConfig.customOrderingRules.disableDefaultOrderSort,
                    numberOfEmptyLinesAfterGroup: this.getDefaultLineNumber(),
                    orderLevel: this.sortConfig.customOrderingRules.defaultOrderLevel,
                    regex: null
                }, x);
                return;
            }
            this.addElement(result, rule, x);
        })
            .value();
        const customSortedImports = lodash.chain(Object.keys(result))
            .orderBy(x => +x)
            .map(x => result[x])
            .value();
        return customSortedImports;
    }
    matchNameBindings(importElement, regex) {
        //match an empty string here
        if (!importElement.hasFromKeyWord) {
            return ''.match(regex) !== null;
        }
        if (importElement.defaultImportName && importElement.defaultImportName.trim() !== '') {
            return importElement.defaultImportName.match(regex) !== null;
        }
        return importElement.namedBindings.some(x => x.name.match(regex) !== null);
    }
    addElement(dictionary, rule, value) {
        if (lodash.isNil(dictionary[rule.orderLevel])) {
            dictionary[rule.orderLevel] = { elements: [], numberOfEmptyLinesAfterGroup: rule.numberOfEmptyLinesAfterGroup, customOrderRule: rule };
            dictionary[rule.orderLevel].elements = [value];
        }
        else {
            dictionary[rule.orderLevel].elements.push(value);
        }
    }
    getSortOrderFunc(sortOrder, changePeriodOrder = false) {
        if (sortOrder === 'caseInsensitive') {
            return (x) => changePeriodOrder ? this.parseStringWithPeriod(x.toLowerCase()) : x.toLowerCase();
        }
        if (sortOrder === 'lowercaseLast') {
            return (x) => changePeriodOrder ? this.parseStringWithPeriod(x) : x;
        }
        if (sortOrder === 'unsorted') {
            return (_x) => '';
        }
        if (sortOrder === 'lowercaseFirst') {
            return (x) => changePeriodOrder ? this.parseStringWithPeriod(this.swapStringCase(x)) : this.swapStringCase(x);
        }
    }
    parseStringWithPeriod(value) {
        return value && value.startsWith('.') ? value.replace('.', NEW_PERIOD_CHAR) : value;
    }
    swapStringCase(str) {
        if (str == null) {
            return '';
        }
        let result = '';
        for (let i = 0; i < str.length; i++) {
            const c = str[i];
            const u = c.toUpperCase();
            result += u === c ? c.toLowerCase() : u;
        }
        return result;
    }
}

class SimpleImportRunner {
    constructor(parser, sorter, importCreator, configurationProvider) {
        this.parser = parser;
        this.sorter = sorter;
        this.importCreator = importCreator;
        this.configurationProvider = configurationProvider;
    }
    getSortImportData(filePath, fileSource) {
        this.resetConfiguration();
        return this.getSortedData(filePath, fileSource);
    }
    sortImportsInDirectory(directoryPath) {
        this.resetConfiguration();
        return this.sortAllImports$(directoryPath);
    }
    resetConfiguration() {
        const configuration = this.configurationProvider.getConfiguration();
        this.sorter.initialise(configuration.sortConfiguration);
        this.importCreator.initialise(configuration.importStringConfiguration);
    }
    getSortedData(filePath, fileSource) {
        const isFileExcluded = this.isFileExcludedFromSorting(filePath);
        if (isFileExcluded) {
            return {
                isSortRequired: false,
                sortedImportsText: null,
                rangesToDelete: null,
                firstLineNumberToInsertText: null
            };
        }
        const imports = this.parser.parseImports(filePath, fileSource);
        if (!imports.importElements.length) {
            return {
                isSortRequired: false,
                sortedImportsText: null,
                rangesToDelete: null,
                firstLineNumberToInsertText: null
            };
        }
        const sortedImports = this.sorter.sortImportElements(imports.importElements);
        const sortedImportsWithExcludedImports = this.getExcludeUnusedImports(sortedImports, imports.usedTypeReferences);
        const sortedImportsText = this.importCreator.createImportText(sortedImportsWithExcludedImports.groups);
        //normalize imports by skipping lines which should not be touched
        const fileSourceWithSkippedLineShiftArray = fileSource.split('\n').slice(imports.firstImportLineNumber);
        const fileSourceWithSkippedLineShift = fileSourceWithSkippedLineShiftArray.join('\n');
        const fileSourceArray = fileSource.split('\n');
        const importTextArray = sortedImportsText.split('\n');
        const isSorted = this.isSourceAlreadySorted({ data: importTextArray, text: sortedImportsText }, { data: fileSourceWithSkippedLineShiftArray, text: fileSourceWithSkippedLineShift });
        if (isSorted) {
            return {
                isSortRequired: false,
                sortedImportsText,
                rangesToDelete: null,
                firstLineNumberToInsertText: imports.firstImportLineNumber
            };
        }
        const rangesToDelete = this.getRangesToDelete(sortedImportsWithExcludedImports, fileSourceArray, fileSource);
        return {
            isSortRequired: true,
            sortedImportsText,
            rangesToDelete,
            firstLineNumberToInsertText: imports.firstImportLineNumber
        };
    }
    getExcludeUnusedImports(sortResult, usedTypeReferences) {
        const isRemoveUnusedImports = this.configurationProvider.getConfiguration().sortConfiguration.removeUnusedImports;
        if (!isRemoveUnusedImports) {
            return {
                groups: sortResult.groups,
                toRemove: sortResult.duplicates
            };
        }
        const isRemoveUnusedDefaultImports = this.configurationProvider.getConfiguration().sortConfiguration.removeUnusedDefaultImports;
        const sortResultClonned = lodash.cloneDeep(sortResult);
        const unusedImportElements = [];
        sortResultClonned.groups.forEach(gr => {
            gr.elements = gr.elements.filter(el => {
                //side effect import
                if (!el.hasFromKeyWord) {
                    return true;
                }
                //filtering name bindings
                el.namedBindings = el.namedBindings.filter(nameBinding => {
                    const isUnusedNameBinding = !usedTypeReferences.some(reference => reference === (nameBinding.aliasName || nameBinding.name));
                    return !isUnusedNameBinding;
                });
                if (!isRemoveUnusedDefaultImports && el.defaultImportName) {
                    return true;
                }
                if (isRemoveUnusedDefaultImports && usedTypeReferences.some(reference => reference === el.defaultImportName)) {
                    return true;
                }
                //if not default import and not side effect, then check name bindings
                if (!el.namedBindings.length) {
                    unusedImportElements.push(el);
                    return false;
                }
                return true;
            });
            return !gr.elements.length;
        });
        return {
            groups: sortResultClonned.groups,
            toRemove: [...unusedImportElements, ...sortResultClonned.duplicates]
        };
    }
    sortAllImports$(startingSourcePath) {
        const allFilePaths$ = this.allFilePathsUnderThePath$(startingSourcePath);
        return allFilePaths$.pipe(operators.mergeAll(), operators.flatMap(path => this.sortFileImports$(path), 3));
    }
    sortFileImports$(fullFilePath) {
        return readFile$(fullFilePath).pipe(operators.switchMap(file => {
            const sortedData = this.getSortedData(fullFilePath, file);
            if (sortedData.isSortRequired) {
                const sortedFullFileSource = this.getFullSortedSourceFile(file, sortedData);
                return writeFile$(fullFilePath, sortedFullFileSource);
            }
            else {
                return rxjs.empty();
            }
        }));
    }
    getFullSortedSourceFile(sourceText, sortedData) {
        let fileSourceArray = sourceText.split('\n');
        const linesToDelete = lodash.chain(sortedData.rangesToDelete.map(range => lodash.range(range.startLine, range.endLine)))
            .flatMap(ranges => ranges)
            .value();
        for (let i = linesToDelete.length - 1; i >= 0; i--) {
            if (i === 0) {
                fileSourceArray.splice(linesToDelete[i], 1, sortedData.sortedImportsText);
            }
            else {
                fileSourceArray.splice(linesToDelete[i], 1);
            }
        }
        const sortedText = fileSourceArray.join('\n');
        return sortedText;
    }
    allFilePathsUnderThePath$(startingSourcePath) {
        if (!startingSourcePath) {
            throw new Error('No directory selected.');
        }
        const allFilesPatterns = ['**/*.ts', '**/*.tsx'];
        const ignore = [];
        const filesPaths$ = allFilesPatterns.map(pattern => filePaths$(startingSourcePath, pattern, ignore));
        return rxjs.merge(...filesPaths$);
    }
    isLineEmptyOrWhiteSpace(line) {
        if (!line) {
            return true;
        }
        const trimmedLine = line.trim();
        return trimmedLine === '';
    }
    isSourceAlreadySorted(sortedImport, source) {
        if (source.data.length >= sortedImport.data.length &&
            this.isLineEmptyOrWhiteSpace(source.data[sortedImport.data.length - 1]) &&
            ((source.data.length > sortedImport.data.length && !this.isLineEmptyOrWhiteSpace(source.data[sortedImport.data.length])) ||
                (source.data.length === sortedImport.data.length + 1 && this.isLineEmptyOrWhiteSpace(source.data[sortedImport.data.length])) ||
                source.data.length === sortedImport.data.length) &&
            source.text.replace(/\r/g, '').startsWith(sortedImport.text)) {
            return true;
        }
        return false;
    }
    getNextNonEmptyLine(startLineIndex, fileSourceArray) {
        const nextLineIndex = startLineIndex + 1;
        if (fileSourceArray.length < 0) {
            return null;
        }
        if (nextLineIndex > fileSourceArray.length - 1) {
            return { lineNumber: nextLineIndex - 1, isLast: true };
        }
        const nextLine = fileSourceArray[nextLineIndex];
        if (nextLine === undefined) {
            return null;
        }
        else if (!this.isLineEmptyOrWhiteSpace(nextLine)) {
            return { lineNumber: nextLineIndex, isLast: false };
        }
        else {
            return this.getNextNonEmptyLine(nextLineIndex, fileSourceArray);
        }
    }
    getRangesToDelete(sortedImportsResult, fileSourceArray, fileSourceText) {
        const sortedImports = lodash.chain(sortedImportsResult.groups).flatMap(x => x.elements).value();
        const rangesToDelete = [];
        lodash.chain(sortedImports)
            .concat(sortedImportsResult.toRemove)
            .sortBy(x => x.startPosition.line)
            .forEach(x => {
            const previousRange = rangesToDelete[rangesToDelete.length - 1];
            const firstLeadingComment = x.importComment.leadingComments[0];
            const lastTrailingComment = x.importComment.trailingComments.reverse()[0];
            const startPosition = firstLeadingComment ? getPositionByOffset(firstLeadingComment.range.pos, fileSourceText) : x.startPosition;
            const endPosition = lastTrailingComment ? getPositionByOffset(lastTrailingComment.range.end, fileSourceText) : x.endPosition;
            let currentRange = new LineRange({
                startLine: startPosition.line,
                startCharacter: startPosition.character,
                endLine: endPosition.line + 1,
                endCharacter: 0
            });
            const nextNonEmptyLine = this.getNextNonEmptyLine(currentRange.endLine - 1, fileSourceArray);
            if (nextNonEmptyLine && !nextNonEmptyLine.isLast && nextNonEmptyLine.lineNumber !== currentRange.endLine) {
                currentRange = new LineRange({
                    startLine: currentRange.startLine,
                    startCharacter: currentRange.startCharacter,
                    endLine: nextNonEmptyLine.lineNumber,
                    endCharacter: 0
                });
            }
            if (!nextNonEmptyLine || (nextNonEmptyLine && nextNonEmptyLine.isLast)) {
                const lastLine = fileSourceArray[fileSourceArray.length - 1];
                currentRange = new LineRange({
                    startLine: currentRange.startLine,
                    startCharacter: currentRange.startCharacter,
                    endLine: fileSourceArray.length - 1,
                    endCharacter: lastLine.length
                });
            }
            if (!previousRange) {
                rangesToDelete.push(currentRange);
                return;
            }
            if (previousRange.isLineIntersecting(currentRange)) {
                rangesToDelete[rangesToDelete.length - 1] = previousRange.union(currentRange);
                return;
            }
            rangesToDelete.push(currentRange);
        })
            .value();
        return rangesToDelete;
    }
    isFileExcludedFromSorting(selectedPath) {
        const excludedFiles = this.configurationProvider.getConfiguration().generalConfiguration.exclude || [];
        if (!excludedFiles.length) {
            return false;
        }
        const filePath = selectedPath.replace(new RegExp('\\' + path.sep, 'g'), '/');
        const isExcluded = excludedFiles.some(fileToExclude => filePath.match(fileToExclude) !== null);
        return isExcluded;
    }
}

const nodePath = 'node';
class CLIConfigurationProvider {
    getConfiguration() {
        return this.currentConfiguration;
    }
    resetConfiguration(path) {
        return __awaiter(this, void 0, void 0, function* () {
            this.currentConfiguration = yield this._getConfiguration(path);
        });
    }
    // Get default config,
    // extend it to be non-conflicting with prettier
    // extend it further with local vscode config to be in sync
    _getConfiguration(path) {
        return __awaiter(this, void 0, void 0, function* () {
            const prettierConfig = yield this._getPrettierConfiguration(path);
            const localConfig = yield this._getLocalConfiguration(path);
            return lodash.defaultsDeep({
                importStringConfiguration: {
                    quoteMark: prettierConfig.singleQuote ? 'single' : undefined,
                    tabSize: prettierConfig.tabWidth,
                    maximumNumberOfImportExpressionsPerLine: {
                        count: prettierConfig.printWidth
                    },
                    trailingComma: prettierConfig.trailingComma
                        ? prettierConfig.trailingComma
                        : undefined,
                    hasSemicolon: typeof prettierConfig.semi !== 'undefined' ? prettierConfig.semi : undefined
                }
            }, localConfig, this._getDefaultConfiguration());
        });
    }
    _parseConfig(config) {
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
                }
                else {
                    sum[currentKey] = {};
                }
                return sum[currentKey];
            }, total);
            return total;
        })
            .reduce((sum, currentObj) => lodash.merge(sum, currentObj), {});
    }
    _getDefaultConfiguration() {
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
    _getPrettierConfiguration(path$1) {
        return __awaiter(this, void 0, void 0, function* () {
            const prettierCLIPath = yield this._getPrettierPath(path$1);
            return prettierCLIPath
                ? new Promise((res, rej) => {
                    child_process.exec(`${nodePath} ${prettierCLIPath} --find-config-path '${path$1}'`, (error, stdout) => {
                        error ? rej(error) : res(path.resolve(stdout.trim()));
                    });
                })
                    .then((path) => {
                    return readFile$(path)
                        .pipe(operators.map((content) => JSON.parse(content)))
                        .toPromise();
                })
                    .catch((_) => {
                    return {};
                })
                : {};
        });
    }
    // check if vscode sorter config exists
    _getLocalConfiguration(path$1) {
        return __awaiter(this, void 0, void 0, function* () {
            const homeDir = os.homedir();
            let depth = 1;
            let currentPath = path.resolve(path$1);
            let settingsPath;
            let exists = false;
            while (!exists && depth < 100 && currentPath !== homeDir) {
                settingsPath = path.resolve(currentPath, './.vscode/settings.json');
                exists = fs.existsSync(settingsPath);
                currentPath = path.resolve(path$1, '../'.repeat(depth++));
            }
            return readFile$(settingsPath)
                .pipe(operators.map((content) => {
                // Remove comments from json
                return this._parseConfig(JSON.parse(content.replace(/(\/\/.+\n)/g, '')));
            }))
                .toPromise()
                .catch((_) => {
                return {};
            });
        });
    }
    // find closest to given path prettier installation
    _getPrettierPath(path$1) {
        return __awaiter(this, void 0, void 0, function* () {
            const homeDir = os.homedir();
            let depth = 1;
            let currentPath = path.resolve(path$1);
            let prettierPath;
            let exists = false;
            while (!exists && depth < 100 && currentPath !== homeDir) {
                prettierPath = path.resolve(currentPath, './node_modules/.bin/prettier');
                exists = fs.existsSync(prettierPath);
                currentPath = path.resolve(path$1, '../'.repeat(depth++));
            }
            return exists ? prettierPath : null;
        });
    }
    _findPackageConfigPath() {
        const homeDir = os.homedir();
        let depth = 1;
        let currentPath = __filename;
        let packagePath;
        let exists = false;
        while (!exists && depth < 100 && currentPath !== homeDir) {
            packagePath = path.resolve(currentPath, './package.json');
            exists = fs.existsSync(packagePath);
            currentPath = path.resolve(__filename, '../'.repeat(depth++));
        }
        return exists ? packagePath : null;
    }
}
class ImportSorterCLI {
    initialise() {
        this.configurationProvider = new CLIConfigurationProvider();
        this.importRunner = new SimpleImportRunner(new SimpleImportAstParser(), new InMemoryImportSorter(), new InMemoryImportCreator(), this.configurationProvider);
    }
    sortImportsInFile(filePath) {
        return rxjs.from(this.configurationProvider.resetConfiguration(filePath))
            .pipe(operators.concatMap(() => readFile$(filePath)))
            .pipe(operators.concatMap((content) => {
            const result = this.importRunner.getSortImportData(filePath, content);
            if (result.isSortRequired) {
                console.log(`${filePath} needs to be sorted, sorting...`);
                return writeFile$(filePath, this.getFullSortedSourceFile(content, result))
                    .toPromise()
                    .then(() => {
                    console.log(`${filePath} saved`);
                });
            }
            else {
                return rxjs.EMPTY;
            }
        }), operators.mapTo(void 0))
            .toPromise()
            .catch(console.log);
    }
    sortImportsInDirectory(dirPath) {
        return rxjs.from(this.configurationProvider.resetConfiguration(dirPath))
            .pipe(operators.concatMap(() => this.importRunner.sortImportsInDirectory(dirPath)))
            .toPromise();
    }
    getSortResultOfFile(filePath) {
        return rxjs.from(this.configurationProvider.resetConfiguration(filePath))
            .pipe(operators.concatMap(() => readFile$(filePath)))
            .pipe(operators.concatMap((content) => {
            const result = this.importRunner.getSortImportData(filePath, content);
            return rxjs.of(result);
        }))
            .toPromise();
    }
    getFullSortedSourceFile(sourceText, sortedData) {
        let fileSourceArray = sourceText.split('\n');
        const linesToDelete = lodash.chain(sortedData.rangesToDelete.map((range) => lodash.range(range.startLine, range.endLine)))
            .flatMap((ranges) => ranges)
            .value();
        for (let i = linesToDelete.length - 1; i >= 0; i--) {
            if (i === 0) {
                fileSourceArray.splice(linesToDelete[i], 1, sortedData.sortedImportsText);
            }
            else {
                fileSourceArray.splice(linesToDelete[i], 1);
            }
        }
        const sortedText = fileSourceArray.join('\n');
        return sortedText;
    }
}

const args = process.argv.slice(2);
if (args.length === 0) {
    process.exit(0);
}
const importSorterCLI = new ImportSorterCLI();
importSorterCLI.initialise();
args.map((url) => __awaiter(void 0, void 0, void 0, function* () {
    const resolvedPath = path.resolve(url);
    if (fs.existsSync(resolvedPath)) {
        if (fs.statSync(resolvedPath).isDirectory()) {
            console.log(`${resolvedPath} is directory`);
            yield importSorterCLI.sortImportsInDirectory(resolvedPath);
        }
        else if (fs.statSync(resolvedPath).isFile()) {
            yield importSorterCLI.sortImportsInFile(resolvedPath);
        }
    }
}));
