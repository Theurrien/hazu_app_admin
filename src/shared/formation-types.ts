// Shared types for the Missions formation overview. No IO.

/** One Hazu item, normalised from any of the API's row envelopes. */
export interface Row {
  id: string;
  parentId: string | null;
  type: string;
  title: string;
  description: string;
  tags: string[];
  icon: string | null;
  color: string | null;
  dateCreated: number;
  authorId: string | null;
  authorName: string | null;
  order: number | null;
}

/** One assessment of one MPE copy, parsed from a timeline item. */
export interface AssessmentFact {
  copyId: string;
  authorId: string | null;
  authorName: string;
  points: number;
  feedback: string | null;
  dateMs: number;
}
