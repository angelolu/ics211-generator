import type { FormHeaderData, FormRowData, FormStateData } from '../hooks/useFormState';

export interface BaseFormProps {
  formState: FormStateData;
  highlightChanges: boolean;
  activityType?: 'exercise' | 'event' | 'incident';
  showPhone?: boolean;
  showEmail?: boolean;
  emailMap?: Record<number, string>;
  showCalcHours?: boolean;
  showId?: boolean;
  idsMap?: Record<number, string>;
  showStatus?: boolean;
  statusMap?: Record<number, string>;
  showRole?: boolean;
  rolesMap?: Record<number, string>;
  showPositions?: boolean;
  positionsMap?: Record<number, string>;
  showMedical?: boolean;
  medicalMap?: Record<number, string>;
  showTechnical?: boolean;
  technicalMap?: Record<number, string>;
  onUpdateHeader: (key: keyof FormHeaderData, value: string) => void;
  onUpdateRow: (rowId: string, colKey: keyof FormRowData['cells'], value: string) => void;
  onRemoveRow?: (rowId: string) => void;
  onRestoreRow?: (rowId: string) => void;
}

export interface ICS211FitnessFormProps extends BaseFormProps {
  showValidation?: boolean;
}
