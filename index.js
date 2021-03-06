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
app.set('trust proxy', true);

const host = process.env.HOST || 'http://localhost:3000'

const oneDay = 24 * 60 * 60 * 1000
// max quota per IP = 240Mb or 100 files (up to 240 Mb total)
const maxQuota = {
  size: 240 * 1024 * 1024,
  count: 100
}

const uploadSingleFile = upload.single('file')

app.post('/upload', function (req, res) {

  const ipQuotaSelect = `quotas.byIp["${req.ip}"]`

  const quota = db
    .defaultsDeep(set({}, ipQuotaSelect, { size: 0, count: 0 }))
    .get(ipQuotaSelect)
    .value()

  if (quota.size >= maxQuota.size) return res.status(507).send()
  if (quota.count >= maxQuota.count) return res.status(507).send()

  uploadSingleFile(req, res, function(err) {
    if (err) return res.status(413).send()

    // here on: file's been uploaded.

    const defaultOptions = {
      accessCount: 0,
      accessLimit: 1,
      expires: Date.now() + oneDay
    }
  
    const options = assign({}, defaultOptions, pick(req.body, [
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
  
    const file = assign({}, fileInfo, options, {
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
      db.set(ipQuotaSelect, {
        size: quota.size + file.size,
        count: quota.count + 1
      }).write()

      // save file data in db
      db.get('files')
        .push(file)
        .write()
      
      // respond access info
      const resBody = {
        link: `${host}/file/${file.filename}/${file.originalname}`,
        expires: new Date(file.expires).toISOString(),
        accessLimit: file.accessLimit
      }
      res.send(resBody)
    } catch(e) {
      res.status(418).send()
    }
  })
});

app.get('/file/:id/:originalname', function (req, res) {
  try {
    const id = req.params.id
    const file = db.get('files').find({ filename: id }).value()
    if (!file) {
      throw Error()
    }
    check(file)
    // check() will throw exception if something is wrong
    const data = fs.readFileSync(file.path)
    res.contentType(file.mimetype)
    res.end(data)
    afterDownload(file)
/*    res.download(file.path, file.originalname, function (err) {
      // this would prevent updating quota and delete if last allowed visit
      // but what if the clients response is spoofed
      // so the backend believes it wasnt downloaded because some error
      // that could be a potential exploit 
      // @TODO make sure express' res.download handles it
      if (err) throw Error()
      afterDownload(file)
    }) */
  } catch (e) {
    res.status(418).send()
  }
})


function check(file) {
  if (file.expires < Date.now()) {
    remove(file)
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
    return
  } // else:

  // update access count
  db.get('files')
    .find(file)
    .assign({ accessCount: file.accessCount + 1 })
    .write()
}
function remove(file) {
  try {
    const files = db.get('files')
    // delete from db if present
    if (files.some(f => f.filename === file.filename)) {
      files
        .remove(file)
        .write()
    }
    // delete file
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
      const inDB = db
        .get('files')
        .find({ filename: filename })
        .value()
      if (inDB) {
        return
      }
      // remove files that are not in DB
      remove({
        filename: filename,
        path: multerOptions.dest + filename
      })
    })
  })
}, 15 * 60 * 1000)

app.listen(process.env.PORT || 3000);
