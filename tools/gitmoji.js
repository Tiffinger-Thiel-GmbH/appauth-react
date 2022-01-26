const https = require('https');
const fs = require('fs');
const path = require('path');
const packageJson = require(path.join(__dirname, "../package.json"))

const additionalEmojis = ['🐋']

https.get("https://raw.githubusercontent.com/carloscuesta/gitmoji/master/src/data/gitmojis.json", (res) => {
  let body = "";

  res.on("data", (chunk) => {
      body += chunk;
  });

  res.on("end", () => {
      try {
          let json = JSON.parse(body);
          
          const emojis = json.gitmojis.map((m) => m.emoji)
          emojis.push(...additionalEmojis)

          const joined = emojis.join("|")
          const regexp = `^(${joined}) .+$`
          console.log(regexp)

          fs.writeFileSync(path.join(__dirname, "gitmoji.regexp"), regexp)
      } catch (error) {
          console.error(error.message);
      };
  });

}).on("error", (error) => {
  console.error(error.message);
});





