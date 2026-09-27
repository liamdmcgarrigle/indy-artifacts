/**
 * The node views used only while a page is being edited. DocView loads this
 * module when editing starts, so readers and visitors never download the
 * editing code (yaml, the data grids, the source boxes).
 */
export { KpisEdit } from "./KpisEdit";
export { TableEdit } from "./DataEdit";
export { ChartEdit } from "./chart/ChartBuilder";
export { EmbedEdit, RawEdit } from "./SourceEdit";
