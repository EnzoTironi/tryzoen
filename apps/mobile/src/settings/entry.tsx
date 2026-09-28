import { Fragment, useState, type ReactNode } from "react";
import { ActionButton } from "@zoen/companion-ui";
import { auth } from "../auth";

/** Reopening a panel, or changing session, starts a fresh confirmation flow. */
export function SettingsEntry({
  label,
  children,
}: {
  readonly label: string;
  readonly children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const account = auth.useSession();
  const close = () => {
    setOpen(false);
  };
  return (
    <>
      <ActionButton
        quiet
        onPress={() => {
          setOpen(true);
        }}
      >
        {label}
      </ActionButton>
      {open && (
        <Fragment key={account.data?.session.id ?? "signed-out"}>
          {children(close)}
        </Fragment>
      )}
    </>
  );
}
