rm -rf book;
rm -rf _book;
docker run -it --init -p 4000:4000  -v `pwd`:`pwd` -w `pwd` --rm  honkit/honkit:v4.0.4 honkit serve;