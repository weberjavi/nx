import { performance } from 'perf_hooks';
import { ProjectConfiguration } from '../../config/workspace-json-project-json';
import {
  NX_ANGULAR_JSON_PLUGIN_NAME,
  shouldMergeAngularProjects,
} from '../../adapter/angular-json';
import { NxJsonConfiguration, readNxJson } from '../../config/nx-json';
import { ProjectGraphExternalNode } from '../../config/project-graph';
import {
  buildProjectsConfigurationsFromProjectPathsAndPlugins,
  ConfigurationSourceMaps,
} from './project-configuration-utils';
import { RemotePlugin, loadNxPlugins } from '../plugins/internal-api';
import {
  getNxWorkspaceFilesFromContext,
  globWithWorkspaceContext,
} from '../../utils/workspace-context';
import { buildAllWorkspaceFiles } from './build-all-workspace-files';
import { join } from 'path';

/**
 * Walks the workspace directory to create the `projectFileMap`, `ProjectConfigurations` and `allWorkspaceFiles`
 * @throws
 * @param workspaceRoot
 * @param nxJson
 */
export async function retrieveWorkspaceFiles(
  workspaceRoot: string,
  projectRootMap: Record<string, string>
) {
  performance.mark('native-file-deps:start');
  performance.mark('native-file-deps:end');
  performance.measure(
    'native-file-deps',
    'native-file-deps:start',
    'native-file-deps:end'
  );

  performance.mark('get-workspace-files:start');

  const { projectFileMap, globalFiles, externalReferences } =
    getNxWorkspaceFilesFromContext(workspaceRoot, projectRootMap);
  performance.mark('get-workspace-files:end');
  performance.measure(
    'get-workspace-files',
    'get-workspace-files:start',
    'get-workspace-files:end'
  );

  return {
    allWorkspaceFiles: buildAllWorkspaceFiles(projectFileMap, globalFiles),
    fileMap: {
      projectFileMap,
      nonProjectFiles: globalFiles,
    },
    rustReferences: externalReferences,
  };
}

/**
 * Walk through the workspace and return `ProjectConfigurations`. Only use this if the projectFileMap is not needed.
 *
 * @param workspaceRoot
 * @param nxJson
 */
export async function retrieveProjectConfigurations(
  workspaceRoot: string,
  nxJson: NxJsonConfiguration
): Promise<RetrievedGraphNodes> {
  const plugins = await loadNxPlugins(nxJson?.plugins ?? [], workspaceRoot);

  return _retrieveProjectConfigurations(workspaceRoot, nxJson, plugins);
}

export async function retrieveProjectConfigurationsWithAngularProjects(
  workspaceRoot: string,
  nxJson: NxJsonConfiguration
): Promise<RetrievedGraphNodes> {
  const pluginsToLoad = nxJson?.plugins ?? [];

  if (
    shouldMergeAngularProjects(workspaceRoot, true) &&
    !pluginsToLoad.some(
      (p) =>
        p === NX_ANGULAR_JSON_PLUGIN_NAME ||
        (typeof p === 'object' && p.plugin === NX_ANGULAR_JSON_PLUGIN_NAME)
    )
  ) {
    pluginsToLoad.push(join(__dirname, '../../adapter/angular-json'));
  }

  const plugins = await loadNxPlugins(nxJson?.plugins ?? [], workspaceRoot);

  return _retrieveProjectConfigurations(workspaceRoot, nxJson, plugins);
}

export type RetrievedGraphNodes = {
  externalNodes: Record<string, ProjectGraphExternalNode>;
  projects: Record<string, ProjectConfiguration>;
  sourceMaps: ConfigurationSourceMaps;
  projectRootMap: Record<string, string>;
};

function _retrieveProjectConfigurations(
  workspaceRoot: string,
  nxJson: NxJsonConfiguration,
  plugins: RemotePlugin[]
): Promise<RetrievedGraphNodes> {
  const globPatterns = configurationGlobs(plugins);
  const projectFiles = globWithWorkspaceContext(workspaceRoot, globPatterns);

  return createProjectConfigurations(
    workspaceRoot,
    nxJson,
    projectFiles,
    plugins
  );
}

export function retrieveProjectConfigurationPaths(
  root: string,
  plugins: PluginGlobsOnly
): string[] {
  const projectGlobPatterns = configurationGlobs(plugins);
  return globWithWorkspaceContext(root, projectGlobPatterns);
}

const projectsWithoutPluginCache = new Map<
  string,
  Record<string, ProjectConfiguration>
>();

// TODO: This function is called way too often, it should be optimized without this cache
export async function retrieveProjectConfigurationsWithoutPluginInference(
  root: string
): Promise<Record<string, ProjectConfiguration>> {
  const nxJson = readNxJson(root);
  const plugins = await loadNxPlugins([]); // only load default plugins
  const projectGlobPatterns = retrieveProjectConfigurationPaths(root, plugins);
  const cacheKey = root + ',' + projectGlobPatterns.join(',');

  if (projectsWithoutPluginCache.has(cacheKey)) {
    return projectsWithoutPluginCache.get(cacheKey);
  }

  const projectFiles = globWithWorkspaceContext(root, projectGlobPatterns);
  const { projects } = await createProjectConfigurations(
    root,
    nxJson,
    projectFiles,
    plugins
  );

  projectsWithoutPluginCache.set(cacheKey, projects);

  return projects;
}

export async function createProjectConfigurations(
  workspaceRoot: string,
  nxJson: NxJsonConfiguration,
  configFiles: string[],
  plugins: RemotePlugin[]
): Promise<RetrievedGraphNodes> {
  performance.mark('build-project-configs:start');

  const { projects, externalNodes, rootMap, sourceMaps } =
    await buildProjectsConfigurationsFromProjectPathsAndPlugins(
      nxJson,
      configFiles,
      plugins,
      workspaceRoot
    );

  performance.mark('build-project-configs:end');
  performance.measure(
    'build-project-configs',
    'build-project-configs:start',
    'build-project-configs:end'
  );

  return {
    projects,
    externalNodes,
    projectRootMap: rootMap,
    sourceMaps,
  };
}

type PluginGlobsOnly = Array<{ createNodes?: readonly [string, ...unknown[]] }>;

export function configurationGlobs(plugins: PluginGlobsOnly): string[] {
  const globPatterns = [];
  for (const plugin of plugins) {
    if (plugin.createNodes) {
      globPatterns.push(plugin.createNodes[0]);
    }
  }
  return globPatterns;
}
