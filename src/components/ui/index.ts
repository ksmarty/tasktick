/**
 * Public surface of the TaskTick UI kit.
 *
 * Every view imports its primitives from here — `import { Button, Sheet } from
 * '@/components/ui'` — so the kit can be reorganised internally without
 * touching feature code. Nothing in this barrel reaches into `src/app` or
 * `src/server`: it is a client-safe kit.
 */

/* ------------------------------- controls -------------------------------- */
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './Button';
export { IconButton, type IconButtonProps, type IconButtonSize, type IconButtonVariant } from './IconButton';
export { Switch, type SwitchProps } from './Switch';
export { Checkbox, type CheckboxProps } from './Checkbox';
export { SegmentedControl, type SegmentedControlProps, type SegmentedOption } from './SegmentedControl';
export { Select, type SelectOption, type SelectProps } from './Select';
export { Stepper, type StepperProps } from './Stepper';

/* -------------------------------- inputs --------------------------------- */
export { TextArea, TextField, type FieldSize, type TextAreaProps, type TextFieldProps } from './TextField';
export { DateField, type DateFieldProps } from './DateField';
export { TimeField, type TimeFieldProps } from './TimeField';
export { ColorPicker, type ColorPickerProps } from './ColorPicker';

/* --------------------------------- lists --------------------------------- */
export { ListGroup, ListRow, type ListGroupProps, type ListRowProps } from './ListGroup';
export { SectionHeader, type SectionHeaderProps } from './SectionHeader';
export { Divider, type DividerProps } from './Divider';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { Avatar, type AvatarProps } from './Avatar';
export { Badge, type BadgeProps, type BadgeVariant } from './Badge';
export { Chip, type ChipProps } from './Chip';

/* ------------------------------- feedback -------------------------------- */
export { Spinner, type SpinnerProps } from './Spinner';
export { ProgressBar, type ProgressBarProps } from './ProgressBar';
export { ProgressRing, type ProgressRingProps } from './ProgressRing';
export { Skeleton, type SkeletonProps } from './Skeleton';
export { Toast, ToastProvider, useToast, type ToastContextValue, type ToastHandle, type ToastOptions, type ToastProps, type ToastProviderProps, type ToastVariant } from './Toast';

/* ------------------------------- overlays -------------------------------- */
export { Sheet, type SheetProps } from './Sheet';
export { ActionSheet, type ActionSheetAction, type ActionSheetProps } from './ActionSheet';
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';
export { Popover, type PopoverProps } from './Popover';
export { Tooltip, type TooltipProps } from './Tooltip';

/* --------------------------------- chrome -------------------------------- */
export { NavBar, type NavBarProps } from './NavBar';
export { TabBar, type TabBarItem, type TabBarProps } from './TabBar';

/* ----------------------------- small helpers ----------------------------- */
export { Kbd, type KbdProps } from './Kbd';
