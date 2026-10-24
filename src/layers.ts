/**
 * Every layer the app paints in the ROOT stacking context, in the order they stack.
 *
 * A z-index only means anything next to the others it competes with, so a number written on its own,
 * in the file that happens to need it, is not a decision anybody can check. Nine of them were, and on
 * 2026-09-09 three carried comments describing a header that had moved two days earlier: the account
 * menu still argued that staying under the modal was "correct rather than a compromise: the modal
 * covers the header, so the button cannot be open under it", which had inverted into a defence of the
 * exact bug it claimed was unreachable. The party menu, the account menu and the party chat all
 * opened UNDER the media modal, unclickable, and the click that missed them closed the show.
 *
 * So the order lives here, read as a list, and `tests/unit/components/layers.test.ts` refuses a raw
 * number anywhere in `src/`. Adding a popup means adding a line to this file, next to the layers it
 * has to beat, rather than picking a number that looks big enough.
 *
 * WHAT BELONGS HERE is a layer that competes at the ROOT: something fixed, or portalled to the body,
 * or otherwise with no stacking context between it and the document. What does NOT is an ordering
 * inside one box, like a row's own overlay: those keep their own small numbers and are listed in the
 * test with the reason they are not page layers.
 */
export const layer = {
  /** The "All / Anime / Series / Movies" bar, over the rows it filters and under everything else. */
  categoryBar: 1,
  /** The preview card a row hovers open. Under the modal, since a card is only hovered while nothing covers it. */
  hoverCard: 150,
  /** A plugin's release picker, hosted on /watch, where no modal exists. */
  sourcePopup: 300,
  /** A facet dropdown on /search, which likewise never shares a page with the modal. */
  filterMenu: 500,
  /**
   * A show's preview.
   *
   * This overlay is ALSO the modal's own dismiss target and takes pointer events across the whole
   * viewport, so a control under it is not merely dimmed by the 44% black: it is unclickable, and the
   * click meant for it closes the modal. Surviving a modal means being over this number, not visible
   * through it.
   */
  mediaModal: 1000,
  /**
   * The bar, over the modal on purpose: a follower whose host opened a modal still has to reach the
   * party pill and stop following.
   */
  header: 1100,
  /**
   * Anything the bar opens or owns: the party menu, the account menu, the party chat dock.
   *
   * They need a number of their own because a menu is portalled to the body and so does not inherit
   * the bar's, and the chat is fixed at the router root for the same effect. Just above the bar, so a
   * popup stays with the control that opens it, and still under the franchise dialog, which covers
   * the bar deliberately. Going higher is not free: the franchise dialog dismisses on outside press,
   * so a chat button painted over it would throw the graph away on the click that opened the chat.
   */
  headerPopup: 1150,
  /** The relation graph, which opens from inside the modal and covers the bar while it is up. */
  franchiseDialog: 1200,
  /** The plugin invite, which blocks the page until it is answered. */
  pluginPrompt: 2000,
  /**
   * "Updating Stub", the whole page for the moment before an update's reload. Under the party cursor
   * only because an update never goes while a party is running.
   */
  updating: 2500,
  /**
   * The watch party's ghost pointer, over everything, because it says where the host's HAND is and
   * the host is as likely to be pointing at the thing on top. It costs the layers under it nothing,
   * having no pointer events of its own.
   */
  partyCursor: 3000,
} as const

/**
 * FKN's own overlay frame, which the broker docks over the page. NOT OURS TO SET or to draw over:
 * it is here so a number above can be recognised as a mistake, and so a hit test that keeps
 * answering "an iframe" has something to name.
 */
export const FKN_OVERLAY = 2147483647
