const axios = require("axios");
const fs = require('fs')
let endpoint = "https://cloudflare-ipfs.com/ipfs/";

var get_cookies = function (request) {
  var cookies = {};
  if (!request.headers) return cookies;
  const strCookie = request.headers.cookie;
  console.log(strCookie);
  if (!strCookie || strCookie == "") return cookies;
  strCookie && strCookie.split(';').forEach(function (cookie) {
    var parts = cookie.match(/(.*?)=(.*)$/)
    if (parts)
      cookies[parts[1].trim()] = (parts[2] || '').trim();
  });
  //console.log(cookies)
  return cookies;
};
class ipfs {
  async handle_Data(req, res, obj, path) {
    const gw = get_cookies(req)["IPFSgateway"];
    if (!gw || gw == "") {
      let sfile = fs.readFileSync(__dirname + "/template/speedTest.html").toString();
      res.send(sfile);
      return;
    }
    let url = gw + obj.cid;
    if (path != "/") {
      url += path;
      console.log("redirecting to:", url)
      try {
        res.redirect(url);
      } catch (e) {
        console.log("redirect error", e);
      }
      return;
    }
    url += (obj.home ? '/' + obj.home : '')
    console.log("ipfs read:" + url);
    try {
      let res1 = await axios.get(url, {
        method: "GET",
        responseType: "stream"
      });
      //console.log(res1.headers);
      res.set(res1.headers);
      //res.send(res1.data);
      res1.data.pipe(res);

      return true;
    } catch (e) {
      //console.log(e);
      res.end(e.message);
      return false;
    }
    //iframe version
    /*    let frame_file=fs.readFileSync(__dirname + "/template/frame.html").toString();
        frame_file=frame_file.replace('**frame_url**',url);
        if(obj.title){
          frame_file=frame_file.replace('**title**',obj.title);
        }
        res.send(frame_file);*/
  }
}

module.exports = new ipfs();