import {
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
  Image as ImageIcon,
  Link as LinkIcon,
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

export type ActionGroup = "toolbar" | "tile" | "panel" | "bulk" | "tree" | "palette" | "picker"

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
}

export function paletteActions(): LibraryAction[] {
  return Object.values(LIBRARY_ACTIONS).filter((a) => a.group === "palette")
}
