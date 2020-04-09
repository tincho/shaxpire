const fs = require('fs')
const express = require('express')
const serveStatic = require('serve-static')
const set = require('lodash/set')
const assign = require('lodash/assign')
const pick = require('lodash/pick')

const multer = require('multer')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')

const multerOptions = {
  dest: 'uploads/', 
  limits: {
    fileSize: 140 * 1024 * 1024
  }
}
const upload = multer(multerOptions)

const adapter = new FileSync('db.json')
const db = low(adapter)
db.defaults({ files: [], quotas: {} }).write()

const app = express()
app.use(serveStatic('public'));

const host = process.env.HOST || 'http://localhost:3000'

const oneDay = 24 * 60 * 60 * 1000
// max quota per IP = 240Mb
const maxQuota = 240 * 1024 * 1024

const uploadSingleFile = upload.single('file')

app.post('/upload', function (req, res) {

  const ipQuotaSelect = `quotas.byIp[${req.ip}]`

  const quota = db
    .defaultsDeep(set({}, ipQuotaSelect, 0))
    .get(ipQuotaSelec)
    .value()

  if (quota >= maxQuota) return res.status(507).send()

  uploadSingleFile(req, res, function(err) {
    if (err) return res.status(413).send()

    // here on: file's been uploaded.

    const defaultFile = {
      accessCount: 0,
      accessLimit: 1,
      expires: Date.now() + oneDay
    }
  
    const options = assign({}, defaultFile, pick(req.body, [
      'expires',
      'accessLimit',
      'password'
    ]))
    const fileInfo = pick(req.file, [
      'originalname',
      'filename',
      'path',
      'size',
      'mimetype'
    ])
  
    const file = assign({}, options, fileInfo, {
      // max expiration 3 days
      expires: Math.min(
        options.expires,
        Date.now() + oneDay * 3
      ),
      // max access Limit  30
      accessLimit: Math.min(
        options.accessLimit,
        30
      )
    })

    try {
      // update usage quota
      db.set(ipQuotaSelect, quota + file.size)
        .write()
      
      db.get('files')
        .push(file)
        .write()
        
      const resBody = {
        link: `${host}/file/${file.filename}`,
        expires: new Date(file.expires).toISOString(),
        accessLimit: file.accessLimit
      }
      res.send(resBody)
    } catch(e) {
      console.log(e)
      res.status(418).send()
    }
  })
});

app.get('/file/:id', function (req, res) {
  try {
    const id = req.params.id
    const file = db.get('files').find({ filename: id }).value()
    if (!file) {
      throw Error()
    }
    check(file)
    res.download(file.path, file.originalname, function (err) {
      // this would prevent updating quota and delete if last allowed visit
      // but what if the clients response is spoofed
      // so the backend believes it wasnt downloaded because some error
      // that could be a potential exploit 
      // @TODO make sure express' res.download handles it
      if (err) throw Error()
      afterDownload(file)
    })
  } catch (e) {
    res.status(418).send()
  }
})


function check(file) {
  if (file.expires < Date.now()) {
    throw Error()
  }
  if (file.accessCount >= file.accessLimit) {
    // this should never happen, anyway...
    remove(file)
    throw Error()
  }
}

function afterDownload(file) {
  if (file.accessCount === file.accessLimit - 1) {
    // was the last download
    remove(file)
  } else {
    db.get('files')
      .find(file)
      .assign({ accessCount: file.accessCount + 1 })
      .write()
  }
}
function remove(file) {
  try {
    const files = db.get('files')
    if (files.some(f => f.filename === file.filename)) {
      files
        .remove(file)
        .write()
    }

    fs.unlinkSync(file.path)
  } catch(e) {
    console.log(e, ' in remove()')
  }
}

// if ... ?
setInterval(function () {
  db.get('files')
    .filter(file => file.expires < Date.now())
    .value()
    .map(remove)
  fs.readdir(multerOptions.dest, function(err, files) {
    if (err) return
    files.forEach(filename => {
      if (!db.get('files').some(file => file.filename === filename)) {
        remove({
          filename: filename,
          path: multerOptions.dest + filename
        })
      }
    }
  })
}, 15 * 60 * 1000)

app.listen(process.env.PORT || 3000);
