#!/usr/bin/env bash
npm run compile

# In VSCode plugin state
if [[ -e ./node_modules/vscode/bin/install ]];then
    node ./node_modules/vscode/bin/install
fi