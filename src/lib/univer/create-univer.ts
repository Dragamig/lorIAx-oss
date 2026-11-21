import {
  Univer,
  LogLevel,
  IUndoRedoService,
  IAuthzIoService,
  IMentionIOService,
} from "@univerjs/core";
import type {
  DependencyOverride,
  IUniverConfig,
  Plugin,
  PluginCtor,
} from "@univerjs/core";
import { FUniver } from "@univerjs/core/lib/facade";

/**
 * Port local et fidèle de `createUniver` issu de `@univerjs/presets` (Apache-2.0).
 *
 * On le vendorise pour ne plus dépendre du métapaquet `@univerjs/presets`, qui
 * tire en transitif ~26 paquets commerciaux `@univerjs-pro/*` (cf.
 * `docs/briques-libres-licences.md` §Univer). Tout le code utilisé ici provient
 * de `@univerjs/core` (Apache-2.0) ; aucun paquet Pro n'est requis.
 */

type PluginEntry =
  | PluginCtor<Plugin>
  | [PluginCtor<Plugin>, ConstructorParameters<PluginCtor<Plugin>>[0]];

interface IPreset {
  plugins: PluginEntry[];
}

interface IPresetOptions {
  lazy?: boolean;
}

type CreateUniverOptions = Partial<IUniverConfig> & {
  presets: Array<IPreset | [IPreset, IPresetOptions]>;
  plugins?: PluginEntry[];
  override?: DependencyOverride;
  collaboration?: true;
};

function normalizeEntry(
  entry: PluginEntry,
): [PluginCtor<Plugin>, ConstructorParameters<PluginCtor<Plugin>>[0]] {
  return Array.isArray(entry) ? [entry[0], entry[1]] : [entry, undefined];
}

export function createUniver(options: CreateUniverOptions): {
  univer: Univer;
  univerAPI: FUniver;
} {
  const { presets, plugins, collaboration, override = [], ...rest } = options;

  if (collaboration) {
    override.push([IUndoRedoService, null]);
    override.push([IAuthzIoService, null]);
    override.push([IMentionIOService, null]);
  }

  const univer = new Univer({ logLevel: LogLevel.WARN, ...rest, override });

  // La déduplication suit fidèlement la version d'origine : un plugin déjà
  // enregistré par un preset est déplacé en fin de file (delete puis set) pour
  // préserver l'ordre de chargement attendu.
  const registry = new Map<
    string,
    {
      plugin: PluginCtor<Plugin>;
      options: ConstructorParameters<PluginCtor<Plugin>>[0];
    }
  >();

  presets?.forEach((preset) => {
    const resolved = Array.isArray(preset) ? preset[0] : preset;
    resolved.plugins.forEach((entry) => {
      const [plugin, pluginOptions] = normalizeEntry(entry);
      if (registry.has(plugin.pluginName)) registry.delete(plugin.pluginName);
      registry.set(plugin.pluginName, { plugin, options: pluginOptions });
    });
  });

  plugins?.forEach((entry) => {
    const [plugin, pluginOptions] = normalizeEntry(entry);
    if (registry.has(plugin.pluginName)) {
      throw new Error(
        `[createUniver]: plugin ${plugin.pluginName} is already registered by a preset.`,
      );
    }
    registry.set(plugin.pluginName, { plugin, options: pluginOptions });
  });

  registry.forEach(({ plugin, options: pluginOptions }) => {
    univer.registerPlugin(plugin, pluginOptions);
  });

  const univerAPI = FUniver.newAPI(univer);

  return { univer, univerAPI };
}
