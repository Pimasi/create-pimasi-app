#!/usr/bin/env bash

mongorestore --username ${MONGO_INITDB_ROOT_USERNAME} --password ${MONGO_INITDB_ROOT_PASSWORD} --authenticationDatabase admin --nsInclude "${MONGO_INITDB_DATABASE}.*" /seeds
echo "Mongo seeds loaded"
