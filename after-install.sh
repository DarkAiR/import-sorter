#!/usr/bin/env bash
# In VSCode plugin state
if [[ -e ./node_modules/vscode/bin/install ]];then
    node ./node_modules/vscode/bin/install
fi