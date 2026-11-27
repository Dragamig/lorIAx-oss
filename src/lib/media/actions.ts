import {
  Archive,
  ArrowRightLeft,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Eraser,
  FolderInput,
  FolderPen,
  FolderPlus,
  FolderX,
  FileUp,
  RefreshCw,
  LayoutGrid,
  LogOut,
  LibraryBig,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Tags,
  Search,
  Trash2,
  Undo2,
  Upload,
  X,
  FilterX,
  Check,
  Bookmark,
  BookmarkPlus,
  Pencil,
  Pause,
  Play,
  Image as ImageIcon,
  FileText,
  ExternalLink,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Link as LinkIcon,
  Crop,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  Scaling,
  Palette,
  Type,
  Square,
  Circle,
  Minus,
  ArrowUpRight,
  Save,
  WandSparkles,
  Redo2,
  Columns2,
  ZoomIn,
  ZoomOut,
  Maximize,
  SlidersHorizontal,
  Droplet,
  Shapes,
  type LucideIcon,
} from "lucide-react"

export type ActionId =
  | "openLibrary"
  | "upload"
  | "newFolder"
  | "renameFolder"
  | "moveFolder"
  | "deleteFolder"
  | "openProps"
  | "closeProps"
  | "download"
  | "copyLink"
  | "preview"
  | "previewPrev"
  | "previewNext"
  | "trash"
  | "restore"
  | "eraseForever"
  | "move"
  | "editTags"
  | "changeSpace"
  | "selectAll"
  | "clearSelection"
  | "toggleView"
  | "resetFilters"
  | "undo"
  | "cancelUpload"
  | "retryUpload"
  | "pickerInsert"
  | "pickerCancel"
  | "pickerImportUrl"
  | "pickVideoMedia"
  | "pickerTabLibrary"
  | "pickerTabUpload"
  | "pickerTabUrl"
  | "pickerTabBank"
  | "pickerSearchBank"
  | "pickerKeepUploading"
  | "pickerCloseAnyway"
  | "replaceFile"
  | "chooseReplacement"
  | "confirmReplace"
  | "restoreVersion"
  | "downloadVersion"
  | "deleteVersion"
  | "confirmDeleteVersion"
  | "retryVersions"
  | "downloadZip"
  | "downloadFolderZip"
  | "startZip"
  | "cancelZip"
  | "savedViews"
  | "saveView"
  | "editView"
  | "deleteView"
  | "retryViews"
  | "confirmSaveView"
  | "cancelSaveView"
  | "pauseUpload"
  | "resumeUpload"
  | "keepUpload"
  | "confirmCancelUpload"
  | "resumeInterrupted"
  | "abandonInterrupted"
  | "pickResumeFile"
  | "viewText"
  | "reindex"
  | "retryIndex"
  | "openAiSettings"
  | "copyText"
  | "prevMatch"
  | "nextMatch"
  | "closeText"
  | "clearAiIndex"
  | "confirmClearAi"
  | "activateAi"
  | "cancelAi"
  | "openText"
  | "cropRatio"
  | "applyCustomRatio"
  | "cropApply"
  | "cropCancel"
  | "cropReset"
  | "rotateLeft"
  | "rotateRight"
  | "flipH"
  | "flipV"
  | "lockRatio"
  | "scaleTo"
  | "resetSlider"
  | "resetAdjustments"
  | "resetDetail"
  | "applyPreset"
  | "addText"
  | "addRect"
  | "addEllipse"
  | "addLine"
  | "addArrow"
  | "deleteLayer"
  | "confirmRetouchSave"
  | "openRetouch"
  | "closeRetouch"
  | "retouchUndo"
  | "retouchRedo"
  | "compareBefore"
  | "saveRetouch"
  | "downloadRetouch"
  | "zoomOut"
  | "zoomIn"
  | "zoomFit"
  | "toolCrop"
  | "toolRotate"
  | "toolResize"
  | "toolAdjust"
  | "toolFilters"
  | "toolDetail"
  | "toolText"
  | "toolShapes"
  | "retryRetouch"
  | "keepEditing"
  | "discardRetouch"

export type ActionGroup = "toolbar" | "tile" | "panel" | "bulk" | "tree" | "palette" | "picker" | "retouch"

export type LibraryAction = {
  id: ActionId
  icon: LucideIcon
  /** Clé complète dans les messages (espace de noms library.actions). */
  labelKey: string
  /** Touche ou combinaison : Ctrl+Z, Ctrl+A, Delete, Enter. */
  shortcut?: string
  group: ActionGroup
}

function action(
  id: ActionId,
  icon: LucideIcon,
  group: ActionGroup,
  shortcut?: string,
): LibraryAction {
  return { id, icon, labelKey: `library.actions.${id}`, shortcut, group }
}

export const LIBRARY_ACTIONS: Record<ActionId, LibraryAction> = {
  openLibrary: action("openLibrary", LibraryBig, "palette"),
  upload: action("upload", Upload, "palette"),
  newFolder: action("newFolder", FolderPlus, "toolbar"),
  renameFolder: action("renameFolder", FolderPen, "tree"),
  moveFolder: action("moveFolder", FolderInput, "tree"),
  deleteFolder: action("deleteFolder", FolderX, "tree"),
  downloadFolderZip: action("downloadFolderZip", Archive, "tree"),
  startZip: action("startZip", Download, "bulk"),
  cancelZip: action("cancelZip", X, "bulk"),
  openProps: action("openProps", PanelRightOpen, "tile", "Enter"),
  closeProps: action("closeProps", PanelRightClose, "panel"),
  download: action("download", Download, "panel"),
  copyLink: action("copyLink", Copy, "panel"),
  preview: action("preview", Eye, "panel"),
  previewPrev: action("previewPrev", ChevronLeft, "panel", "←"),
  previewNext: action("previewNext", ChevronRight, "panel", "→"),
  trash: action("trash", Trash2, "bulk", "Delete"),
  restore: action("restore", RotateCcw, "bulk"),
  eraseForever: action("eraseForever", Eraser, "bulk"),
  move: action("move", FolderInput, "bulk"),
  editTags: action("editTags", Tags, "bulk"),
  downloadZip: action("downloadZip", Archive, "bulk"),
  changeSpace: action("changeSpace", ArrowRightLeft, "bulk"),
  selectAll: action("selectAll", CheckSquare, "toolbar", "Ctrl+A"),
  clearSelection: action("clearSelection", X, "bulk"),
  toggleView: action("toggleView", LayoutGrid, "toolbar"),
  resetFilters: action("resetFilters", FilterX, "toolbar"),
  undo: action("undo", Undo2, "toolbar", "Ctrl+Z"),
  cancelUpload: action("cancelUpload", X, "toolbar"),
  retryUpload: action("retryUpload", RotateCcw, "toolbar"),
  pickerInsert: action("pickerInsert", Check, "picker"),
  pickerCancel: action("pickerCancel", X, "picker"),
  pickerImportUrl: action("pickerImportUrl", Download, "picker"),
  pickVideoMedia: action("pickVideoMedia", LibraryBig, "picker"),
  pickerTabLibrary: action("pickerTabLibrary", LibraryBig, "picker"),
  pickerTabUpload: action("pickerTabUpload", Upload, "picker"),
  pickerTabUrl: action("pickerTabUrl", LinkIcon, "picker"),
  pickerTabBank: action("pickerTabBank", ImageIcon, "picker"),
  pickerSearchBank: action("pickerSearchBank", Search, "picker"),
  pickerKeepUploading: action("pickerKeepUploading", Upload, "picker"),
  pickerCloseAnyway: action("pickerCloseAnyway", LogOut, "picker"),
  replaceFile: action("replaceFile", Upload, "panel"),
  chooseReplacement: action("chooseReplacement", FileUp, "panel"),
  confirmReplace: action("confirmReplace", Upload, "panel"),
  restoreVersion: action("restoreVersion", RotateCcw, "panel"),
  downloadVersion: action("downloadVersion", Download, "panel"),
  deleteVersion: action("deleteVersion", Trash2, "panel"),
  confirmDeleteVersion: action("confirmDeleteVersion", Trash2, "panel"),
  retryVersions: action("retryVersions", RefreshCw, "panel"),
  savedViews: action("savedViews", Bookmark, "toolbar"),
  saveView: action("saveView", BookmarkPlus, "toolbar"),
  editView: action("editView", Pencil, "toolbar"),
  deleteView: action("deleteView", Trash2, "toolbar"),
  retryViews: action("retryViews", RefreshCw, "toolbar"),
  confirmSaveView: action("confirmSaveView", Check, "toolbar"),
  cancelSaveView: action("cancelSaveView", X, "toolbar"),
  pauseUpload: action("pauseUpload", Pause, "toolbar"),
  resumeUpload: action("resumeUpload", Play, "toolbar"),
  keepUpload: action("keepUpload", Play, "toolbar"),
  confirmCancelUpload: action("confirmCancelUpload", Trash2, "toolbar"),
  resumeInterrupted: action("resumeInterrupted", Play, "toolbar"),
  abandonInterrupted: action("abandonInterrupted", Trash2, "toolbar"),
  pickResumeFile: action("pickResumeFile", FileUp, "toolbar"),
  viewText: action("viewText", FileText, "panel"),
  reindex: action("reindex", RefreshCw, "panel"),
  retryIndex: action("retryIndex", RefreshCw, "panel"),
  openAiSettings: action("openAiSettings", ExternalLink, "panel"),
  copyText: action("copyText", Copy, "panel"),
  prevMatch: action("prevMatch", ChevronUp, "panel"),
  nextMatch: action("nextMatch", ChevronDown, "panel"),
  closeText: action("closeText", X, "panel"),
  clearAiIndex: action("clearAiIndex", Trash2, "panel"),
  confirmClearAi: action("confirmClearAi", Trash2, "panel"),
  activateAi: action("activateAi", Sparkles, "panel"),
  cancelAi: action("cancelAi", X, "panel"),
  openText: action("openText", FileText, "panel"),
  cropRatio: action("cropRatio", Crop, "retouch"),
  applyCustomRatio: action("applyCustomRatio", Check, "retouch"),
  cropApply: action("cropApply", Check, "retouch", "Enter"),
  cropCancel: action("cropCancel", X, "retouch", "Escape"),
  cropReset: action("cropReset", RotateCcw, "retouch"),
  rotateLeft: action("rotateLeft", RotateCcw, "retouch", "Shift+R"),
  rotateRight: action("rotateRight", RotateCw, "retouch", "R"),
  flipH: action("flipH", FlipHorizontal2, "retouch", "Shift+H"),
  flipV: action("flipV", FlipVertical2, "retouch", "Shift+V"),
  lockRatio: action("lockRatio", LinkIcon, "retouch"),
  scaleTo: action("scaleTo", Scaling, "retouch"),
  resetSlider: action("resetSlider", RotateCcw, "retouch"),
  resetAdjustments: action("resetAdjustments", RotateCcw, "retouch"),
  resetDetail: action("resetDetail", RotateCcw, "retouch"),
  applyPreset: action("applyPreset", Palette, "retouch"),
  addText: action("addText", Type, "retouch"),
  addRect: action("addRect", Square, "retouch"),
  addEllipse: action("addEllipse", Circle, "retouch"),
  addLine: action("addLine", Minus, "retouch"),
  addArrow: action("addArrow", ArrowUpRight, "retouch"),
  deleteLayer: action("deleteLayer", Trash2, "retouch", "Delete"),
  confirmRetouchSave: action("confirmRetouchSave", Save, "retouch"),
  openRetouch: action("openRetouch", WandSparkles, "panel"),
  closeRetouch: action("closeRetouch", X, "retouch"),
  retouchUndo: action("retouchUndo", Undo2, "retouch", "Ctrl+Z"),
  retouchRedo: action("retouchRedo", Redo2, "retouch", "Ctrl+Shift+Z"),
  compareBefore: action("compareBefore", Columns2, "retouch", "\\"),
  saveRetouch: action("saveRetouch", Save, "retouch", "Ctrl+S"),
  downloadRetouch: action("downloadRetouch", Download, "retouch"),
  zoomOut: action("zoomOut", ZoomOut, "retouch", "-"),
  zoomIn: action("zoomIn", ZoomIn, "retouch", "+"),
  zoomFit: action("zoomFit", Maximize, "retouch", "0"),
  toolCrop: action("toolCrop", Crop, "retouch", "C"),
  toolRotate: action("toolRotate", RotateCw, "retouch", "P"),
  toolResize: action("toolResize", Scaling, "retouch", "S"),
  toolAdjust: action("toolAdjust", SlidersHorizontal, "retouch", "A"),
  toolFilters: action("toolFilters", Palette, "retouch", "F"),
  toolDetail: action("toolDetail", Droplet, "retouch", "D"),
  toolText: action("toolText", Type, "retouch", "T"),
  toolShapes: action("toolShapes", Shapes, "retouch", "O"),
  retryRetouch: action("retryRetouch", RefreshCw, "retouch"),
  keepEditing: action("keepEditing", Pencil, "retouch"),
  discardRetouch: action("discardRetouch", Trash2, "retouch"),
}

export function paletteActions(): LibraryAction[] {
  return Object.values(LIBRARY_ACTIONS).filter((a) => a.group === "palette")
}
