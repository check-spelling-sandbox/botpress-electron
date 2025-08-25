## Install

Clone the repo and install dependencies:

```bash
git clone https://github.com/botpress/botpress-electron
cd botpress-electron
nvm install
npm i
```
Get your segment and sentry keys and put them into a .env file (see [.env.example](.env.example)). You'll need the other environment parameters if you want to build locally.

## Starting Development

Start the app in the `dev` environment:

```bash
npm start
```

## Packaging for Production

To package apps for the local platform:

```bash
npm run package
```

OR for debugging production instances

```bash
npm run package:dev
```

Binaries will be found in ./release/build/Botpress@version_number-mac.dmg


## Configuration

To set the botpress binary version :

In the main package.json set botpressVersion to the tag that you want (ex. v12_26_10 found here https://s3.amazonaws.com/botpress-binaries/index.html)

To set the release version (for example : Botpress_12.26.10.exe) : 

Set the "version" parameter in the release/app/package.json's "version".

## Release 

GitHub release drafts are created whenever main is updated and there is no existing version found in release/app/package.json's "version".

See the .env.example file for more information about what is needed for release (everything not written _DEV, or CI). You'll need to add these as secrets on GitHub repo. Note that despite the fact that Electron-builder's CSC_LINK and WIN_CSC_LINK ask for links, you can also convert your code signing certificates into base64 and use the strings. 


## A bit about versioning

Botpress-electron generally follows botpress versions. 

If something needs to be changed to fix an issue, it will usually happen after a binary release. What you can do and maintain compatibility with Semantic Versioning is append a dash & letter, like this : 12.26.10-a.




