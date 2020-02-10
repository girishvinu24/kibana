/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { Response } from 'node-fetch';
import { URL } from 'url';
import {
  AssetParts,
  AssetsGroupedByServiceByType,
  CategoryId,
  CategorySummaryList,
  KibanaAssetType,
  RegistryPackage,
  RegistrySearchResults,
} from '../../../../common/types';
import { configService } from '../../';
import { cacheGet, cacheSet } from './cache';
import { ArchiveEntry, untarBuffer } from './extract';
import { fetchUrl, getResponse, getResponseStream } from './requests';
import { streamToBuffer } from './streams';

export { ArchiveEntry } from './extract';

export interface SearchParams {
  category?: CategoryId;
}

export const pkgToPkgKey = ({ name, version }: RegistryPackage) => `${name}-${version}`;

export async function fetchList(params?: SearchParams): Promise<RegistrySearchResults> {
  const registryUrl = configService.getConfig()?.epm.registryUrl;
  const url = new URL(`${registryUrl}/search`);
  if (params && params.category) {
    url.searchParams.set('category', params.category);
  }

  return fetchUrl(url.toString()).then(JSON.parse);
}

export async function fetchInfo(key: string): Promise<RegistryPackage> {
  const registryUrl = configService.getConfig()?.epm.registryUrl;
  return fetchUrl(`${registryUrl}/package/${key}`).then(JSON.parse);
}

export async function fetchFile(filePath: string): Promise<Response> {
  const registryUrl = configService.getConfig()?.epm.registryUrl;
  return getResponse(`${registryUrl}${filePath}`);
}

export async function fetchCategories(): Promise<CategorySummaryList> {
  const registryUrl = configService.getConfig()?.epm.registryUrl;
  return fetchUrl(`${registryUrl}/categories`).then(JSON.parse);
}

export async function getArchiveInfo(
  pkgkey: string,
  filter = (entry: ArchiveEntry): boolean => true
): Promise<string[]> {
  const paths: string[] = [];
  const onEntry = (entry: ArchiveEntry) => {
    const { path, buffer } = entry;
    const { file } = pathParts(path);
    if (!file) return;
    if (buffer) {
      cacheSet(path, buffer);
      paths.push(path);
    }
  };

  await extract(pkgkey, filter, onEntry);

  return paths;
}

export function pathParts(path: string): AssetParts {
  let dataset;

  let [pkgkey, service, type, file] = path.split('/');

  // if it's a dataset
  if (service === 'dataset') {
    // save the dataset name
    dataset = type;
    // drop the `dataset/dataset-name` portion & re-parse
    [pkgkey, service, type, file] = path.replace(`dataset/${dataset}/`, '').split('/');
  }

  // This is to cover for the fields.yml files inside the "fields" directory
  if (file === undefined) {
    file = type;
    type = 'fields';
    service = '';
  }

  return {
    pkgkey,
    service,
    type,
    file,
    dataset,
    path,
  } as AssetParts;
}

async function extract(
  pkgkey: string,
  filter = (entry: ArchiveEntry): boolean => true,
  onEntry: (entry: ArchiveEntry) => void
) {
  const archiveBuffer = await getOrFetchArchiveBuffer(pkgkey);

  return untarBuffer(archiveBuffer, filter, onEntry);
}

async function getOrFetchArchiveBuffer(pkgkey: string): Promise<Buffer> {
  // assume .tar.gz for now. add support for .zip if/when we need it
  const key = `${pkgkey}.tar.gz`;
  let buffer = cacheGet(key);
  if (!buffer) {
    buffer = await fetchArchiveBuffer(pkgkey);
    cacheSet(key, buffer);
  }

  if (buffer) {
    return buffer;
  } else {
    throw new Error(`no archive buffer for ${key}`);
  }
}

async function fetchArchiveBuffer(key: string): Promise<Buffer> {
  const { download: archivePath } = await fetchInfo(key);
  const registryUrl = configService.getConfig()?.epm.registryUrl;
  return getResponseStream(`${registryUrl}${archivePath}`).then(streamToBuffer);
}

export function getAsset(key: string) {
  const buffer = cacheGet(key);
  if (buffer === undefined) throw new Error(`Cannot find asset ${key}`);

  return buffer;
}

export function groupPathsByService(paths: string[]): AssetsGroupedByServiceByType {
  // ASK: best way, if any, to avoid `any`?
  const assets = paths.reduce((map: any, path) => {
    const parts = pathParts(path.replace(/^\/package\//, ''));
    if (parts.type in KibanaAssetType) {
      if (!map[parts.service]) map[parts.service] = {};
      if (!map[parts.service][parts.type]) map[parts.service][parts.type] = [];
      map[parts.service][parts.type].push(parts);
    }

    return map;
  }, {});

  return {
    kibana: assets.kibana,
    // elasticsearch: assets.elasticsearch,
  };
}
