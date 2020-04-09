# Shaxpire


Is pronounced _shake-spear_

NodeJS app built on top of ExpressJS, Multer, LowDB, that will recieve a file upload

## Features

* max size per file of 140Mb
* max uploads per IP hardcoded to 240Mb or 100 files (up to 240Mb total)
* by default access count limit is 30 and expires in 24 hours
 * but this can be set via `expires` and `accessLimit` request body params

## Usage


```bash

git clone ...; cd ...

npm install

PORT=3000 HOST=http://mypublic.addr npm start
```

Access to / to get UI 

POST multipart-encoded form to /upload (single file allowed). 

Response will include link for future access, expiration time and accessLimit


