rm -rf book;
rm -rf _book;
docker run -v `pwd`:`pwd` -w `pwd` --rm -it honkit/honkit:v4.0.4 honkit build;
mv _book book;
mv ./book/favicon.ico ./book/gitbook/images/favicon.ico;
rm -f book/*.md;