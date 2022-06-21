rm -rf book;
rm -rf _book;
npx honkit build;
mv _book book;
mv ./book/favicon.ico ./book/gitbook/images/favicon.ico