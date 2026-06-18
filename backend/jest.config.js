// Mock chalk to avoid ESM import issues in tests
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/agents/self-healing/__tests__'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  moduleNameMapper: {
    '^chalk$': '<rootDir>/__mocks__/chalk.js',
    '^../utils/logger$': '<rootDir>/src/utils/__mocks__/logger.ts',
    '^../../utils/logger$': '<rootDir>/src/utils/__mocks__/logger.ts',
  },
};
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/agents/self-healing/__tests__'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
};
