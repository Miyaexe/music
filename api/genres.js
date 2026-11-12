const GENRES = require("./_genres");

module.exports = (req, res) => {
  res.setHeader("Cache-Control", "public, s-maxage=86400");
  res.status(200).json(GENRES.map(({ id, label }) => ({ id, label })));
};
