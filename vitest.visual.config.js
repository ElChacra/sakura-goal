// Tests visuales en Chrome real (lentos): npm run test:visual
export default { test: { include: ['test/visual/*.spec.js'], testTimeout: 60000, hookTimeout: 60000, fileParallelism: false } };
