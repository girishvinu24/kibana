/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */
/* eslint-disable @typescript-eslint/consistent-type-definitions */

import minimatch from 'minimatch';
import { SimpleSavedObject } from 'src/core/public';
// eslint-disable-next-line @kbn/eslint/no-restricted-paths
import { IndexPatternSavedObjectAttrs } from 'src/plugins/data/common/index_patterns/index_patterns/index_patterns';
import { getIndexPatternService, getUiSettings } from '../../../../kibana_services';

export type IndexPatternMeta = {
  id: string;
  title: string;
};

export async function getSecurityIndexPatterns(): Promise<IndexPatternMeta[]> {
  const uiSettings = getUiSettings();
  let securityIndexPatternTitles: string[];
  try {
    securityIndexPatternTitles = uiSettings.get('securitySolution:defaultIndex');
  } catch (error) {
    // UiSettings throws with unreconized configuration setting
    // siem:defaultIndex configuration setting is not registered if security app is not running
    return [];
  }

  const indexPatternCache = await getIndexPatternService().getCache();
  return indexPatternCache!
    .filter((savedObject: SimpleSavedObject<IndexPatternSavedObjectAttrs>) => {
      return (securityIndexPatternTitles as string[]).some((indexPatternTitle) => {
        // glob matching index pattern title
        return minimatch(indexPatternTitle, savedObject?.attributes?.title);
      });
    })
    .map((savedObject: SimpleSavedObject<IndexPatternSavedObjectAttrs>) => {
      return {
        id: savedObject.id,
        title: savedObject.attributes.title,
      };
    });
}
