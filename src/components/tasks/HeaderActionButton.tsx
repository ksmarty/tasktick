'use client';

/**
 * A header action drawn as a circular floating control.
 *
 * A thin MUI `IconButton`, not a second button: the circle and the tinted
 * surface are `sx`, the behaviour (press feedback, disabled state, accessible
 * name) is still `IconButton`'s.
 *
 * The `::after` overlay takes the touch target back to the 44px the HIG asks
 * for — 4px of hit slop on every side — so the control is not smaller to a
 * finger than the 36px circle looks.
 */
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import type { SvgIconComponent } from '@mui/icons-material';

export type HeaderActionButtonVariant = 'tinted' | 'filled';

export interface HeaderActionButtonProps {
  /** Accessible name. Required: this control is icon-only. */
  'aria-label': string;
  icon: SvgIconComponent;
  onClick?: () => void;
  disabled?: boolean;
  /** `tinted` is the quiet default; `filled` marks an engaged state. */
  variant?: HeaderActionButtonVariant;
  sx?: SxProps<Theme>;
}

export function HeaderActionButton({
  icon: Icon,
  variant = 'tinted',
  sx,
  ...rest
}: HeaderActionButtonProps) {
  return (
    <IconButton
      size="small"
      sx={[
        {
          position: 'relative',
          borderRadius: '50%',
          p: 1,
          bgcolor: variant === 'filled' ? 'primary.main' : 'action.hover',
          color: variant === 'filled' ? 'primary.contrastText' : 'primary.main',
          '&:hover': {
            bgcolor: variant === 'filled' ? 'primary.dark' : 'action.selected',
          },
          // 4px of hit slop on every side: 36px of circle, 44px of target.
          '&::after': { position: 'absolute', inset: -4, content: '""' },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...rest}
    >
      <Icon sx={{ fontSize: 18 }} />
    </IconButton>
  );
}
