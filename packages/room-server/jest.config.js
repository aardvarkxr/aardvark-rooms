/* eslint-disable import/no-extraneous-dependencies */
const { pathsToModuleNameMapper } = require("ts-jest/utils");
// Load the config which holds the path aliases.
const { compilerOptions } = require("../../tsconfig.json");
const path = require('path');

module.exports = {
  preset: "ts-jest",

  moduleNameMapper: {
    // '^@aardvarkxr/aardvark-shared$': path.resolve(__dirname, '../packages/aardvark-shared/src/index.ts'),
    // '^@aardvarkxr/aardvark-react$': path.resolve(__dirname, '../packages/aardvark-react/src/index.ts'),
    '^@aardvarkxr/room-shared$': path.resolve(__dirname, '../room-shared/src/shared_index.ts'),
  },
};
