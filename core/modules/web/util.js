class u {
  static parse_data(data) {
    data = data.replace(/bitfs:\/\//gi, "/bitfs/");
    data = data.replace(/ipfs:\/\//gi, "/ipfs/");
    return data;
  }
  static readableToString(readable) {
    return new Promise((resolve, reject) => {
      let data = "";
      readable.on("data", function(chunk) {
        data += chunk;
      });
      readable.on("end", function() {
        resolve(data);
      });
      readable.on("error", function(err) {
        reject(err);
      });
    });
  }
}

module.exports = u;
