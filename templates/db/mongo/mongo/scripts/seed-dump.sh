#!/usr/bin/env bash
rm -rf /seeds/*
mongodump --username ${MONGO_INITDB_ROOT_USERNAME} --password ${MONGO_INITDB_ROOT_PASSWORD} --authenticationDatabase admin --db ${MONGO_INITDB_DATABASE} --out /seeds
echo "Mongo seeds dumped"
