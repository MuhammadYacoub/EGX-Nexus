module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@redis/(.*)$': '<rootDir>/src/redis/$1',
    '^@normalizer/(.*)$': '<rootDir>/src/normalizer/$1',
    '^@publisher/(.*)$': '<rootDir>/src/publisher/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
  },
};
