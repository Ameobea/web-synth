module.exports = function (source) {
  const minified = JSON.stringify(JSON.parse(source));
  return `module.exports = JSON.parse(${JSON.stringify(minified)});`;
};
