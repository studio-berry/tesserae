// The models the offline classifier flagged as explicit.
//
// The classifier runs while the index is built, over the thumbnail of every model the index
// holds. Nothing at runtime depends on it. The uids here are the ones it was confident about.
//
// The score is kept beside the uid so a reviewer can see how sure the classifier was, and so
// the list can be re-checked against a different threshold without running it again.

export type Flagged = { uid: string; score: number }

export const FLAGGED: Flagged[] = [
  { uid: 'b1dfce7440cc45abaac94e9bc38055fc', score: 0.977 },
  { uid: '1c78af4bd9784c70bdc920843ff54892', score: 0.976 },
  { uid: '5089e74269e14f76af12bd63909dc4e6', score: 0.954 },
  { uid: '1d5fd757538b4b70864af3b5824f5c81', score: 0.945 },
  { uid: '96bd77774fbf475397adaafa470cef11', score: 0.900 },
]

// Whether a uid was flagged as explicit.
export const flagged = (uid: string) => FLAGGED.some((f) => f.uid === uid)
