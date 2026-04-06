// Shared JSDoc type definitions.
// When migrating to TypeScript, convert these to proper interfaces in types.ts.

// ----------------- Core Data Models -----------------

/**
 * @typedef {Object} Box
 * @property {string} weight
 */

/**
 * A freezer inventory item (mirrors the Freezer MongoDB schema).
 * @typedef {Object} FreezerItem
 * @property {string} _id
 * @property {string} location
 * @property {string} [lot]
 * @property {string} [vendor]
 * @property {string} [brand]
 * @property {string} [species]
 * @property {string} [description]
 * @property {string} [grade]
 * @property {string} [quantity]
 * @property {string} [weight]
 * @property {string} [packdate]
 * @property {string} [date_recvd]
 * @property {string} [est]
 * @property {string} [price]
 * @property {string} [scanImageKey]
 * @property {Box[]} [boxes]
 */

/**
 * A history log entry (mirrors the History MongoDB schema).
 * @typedef {Object} HistoryItem
 * @property {string} _id
 * @property {string} time
 * @property {string} change
 * @property {string} [location]
 * @property {string} [lot]
 * @property {string} [vendor]
 * @property {string} [brand]
 * @property {string} [species]
 * @property {string} [description]
 * @property {string} [grade]
 * @property {string} [quantity]
 * @property {string} [weight]
 * @property {string} [packdate]
 * @property {string} [date_recvd]
 * @property {string} [est]
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 */

/**
 * A PDF document stored in S3 (mirrors the PDF MongoDB model).
 * @typedef {Object} PDFItem
 * @property {string} _id
 * @property {string} fileName
 * @property {string} fileKey
 * @property {string} fileUrl
 * @property {string} uploadDate
 */

/**
 * A scan image list entry returned from /list-scans.
 * @typedef {Object} ScanListItem
 * @property {string} _id
 * @property {string} scanImageKey
 * @property {string} [location]
 * @property {string} [lot]
 * @property {string} [species]
 * @property {string} [description]
 * @property {string} [date_recvd]
 */

// ----------------- Form & UI State -----------------

/**
 * Form state used across the homescreen (all fields are strings).
 * @typedef {Object} FormData
 * @property {string} location
 * @property {string} lot
 * @property {string} vendor
 * @property {string} brand
 * @property {string} species
 * @property {string} description
 * @property {string} grade
 * @property {string} quantity
 * @property {string} weight
 * @property {string} packdate
 * @property {string} date_recvd
 * @property {string} est
 * @property {string} price
 */

/**
 * Badge state for the location input field.
 * @typedef {"in" | "out" | "error" | null} BadgeState
 */

/**
 * Validation error map keyed by field name.
 * @typedef {Object.<string, boolean>} ValidationErrors
 */

/**
 * Autocomplete suggestions for vendor and brand fields.
 * @typedef {Object} Suggestions
 * @property {string[]} vendors
 * @property {string[]} brands
 */

// ----------------- Dialog State -----------------

/**
 * @typedef {Object} OccupiedDialogState
 * @property {boolean} open
 * @property {string} message
 * @property {(() => void) | null} onConfirm
 * @property {FreezerItem[]} existingItems
 */

/**
 * @typedef {Object} BulkRemoveDialogState
 * @property {boolean} open
 * @property {string[]} ids
 * @property {FreezerItem[]} items
 * @property {(() => void) | null} onSuccess
 */

/**
 * @typedef {Object} OverwriteDialogState
 * @property {boolean} open
 * @property {FreezerItem[]} existingItems
 */

// ----------------- API Responses -----------------

/**
 * OCR-extracted fields returned from /extract-form.
 * @typedef {Object} ScannerExtractResult
 * @property {string} location
 * @property {string} lot
 * @property {string} vendor
 * @property {string} species
 * @property {string} description
 * @property {string} quantity
 * @property {string} weight
 * @property {string} date_recvd
 * @property {string} packdate
 * @property {number[]} individualWeights
 * @property {string | null} scanImageKey
 * @property {boolean} isTally
 */

/**
 * A single breakdown row from /inventoryStats (by species, grade, or vendor).
 * @typedef {Object} StatsBreakdownItem
 * @property {string} _id
 * @property {number} count
 * @property {number} weight
 * @property {number} value
 */

/**
 * Full response from /inventoryStats.
 * @typedef {Object} InventoryStats
 * @property {number} totalItems
 * @property {number} totalWeight
 * @property {number} totalValue
 * @property {number} occupiedLocations
 * @property {number} totalLocations
 * @property {StatsBreakdownItem[]} bySpecies
 * @property {StatsBreakdownItem[]} byGrade
 * @property {StatsBreakdownItem[]} byVendor
 * @property {FreezerItem[]} oldestPallets
 */

/**
 * A single entry from /inventoryWeeklyThroughput.
 * @typedef {Object} WeeklyThroughputItem
 * @property {string} week
 * @property {number} added
 */

// ----------------- Context -----------------

/**
 * @typedef {Object} FormContextValue
 * @property {FormData} formData
 * @property {React.Dispatch<React.SetStateAction<FormData>>} setFormData
 * @property {React.Dispatch<React.SetStateAction<FreezerItem | null>>} setCurrentItem
 * @property {(location: string) => Promise<void>} onScannerAdd
 */

// ----------------- Component Props -----------------

/**
 * @typedef {Object} DetailsPanelProps
 * @property {FreezerItem | null} item
 * @property {boolean} showDetails
 * @property {() => void} onClose
 * @property {(item: FreezerItem) => void} onSet
 * @property {(item: FreezerItem) => void} onLocate
 * @property {(item: FreezerItem) => void} onItemUpdate
 */

/**
 * @typedef {Object} InventoryTabsProps
 * @property {FreezerItem[]} items
 * @property {(item: FreezerItem) => void} handleItemClick
 * @property {() => void} handleTabClick
 * @property {FreezerItem | null} selectedItem
 * @property {string | null} flashLocation
 * @property {(ids: string[], items: FreezerItem[], onSuccess: () => void) => void} onBulkRemove
 */

/**
 * @typedef {Object} InventoryFormProps
 * @property {FormData} formData
 * @property {(field: string, value: string) => void} onInputChange
 * @property {BadgeState} badgeState
 * @property {ValidationErrors} validationErrors
 * @property {Suggestions} suggestions
 */

/**
 * @typedef {Object} FormScannerProps
 * @property {boolean} isOpen
 * @property {() => void} onClose
 */
