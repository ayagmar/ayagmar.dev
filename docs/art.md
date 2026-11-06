# Art for a post

A post's art is a figure in dots above its title, drawn from a text map ([ADR 0027](adr/0027-room-details-and-per-post-art.md)). The link-preview card shows the same figure in the night colours.

## Pick something from the room

Put one name in the frontmatter:

```yaml
art: record
```

The names are `lamp`, `notebook`, `monitor`, `record`, `cat`, `window` and `tea`. Their maps are in `apps/site/src/art/`. `just art-room` redraws them, which overwrites any edit made to those files, so change the drawing in `apps/site/scripts/art_room.py`.

## Make a map from an image

1. Find an image with a strong silhouette on a plain ground: your own, drawn by you, or public domain or CC0. A dark sculpture on a pale studio sweep works best. Compact shapes with no outline of their own, like a seated figure in dark stone, do not.
2. Make the map. The image stays out of the repository.

   ```sh
   just art-map ~/Pictures/horse.jpg my-post --dark .6
   ```

   This writes `content/writing/my-post.art.txt`. Leave out `--dark` for a subject already on black. `--at .4` moves the figure across the picture, `--echo .2` adds a copy in dim dots, and `--top 55` makes more of it bright. Run `python3 apps/site/scripts/art_map.py --help` for the details.
3. Open the map in an editor and fix it by hand:

   | Character | Draws        |
   | --------- | ------------ |
   | `#`       | a bright dot |
   | `.`       | a dim dot    |
   | `+`       | an amber dot |
   | space     | nothing      |

   Keep amber rare: an eye, one line. Every row must be the same width, at most 144 characters, with at most 30 rows, so keep the trailing spaces. A smaller map sits in the middle of the picture. Anything else fails the build with a message naming the post.
4. Add the map's source and licence to `content/writing/art-sources.txt`. A test fails without it.
5. Name the map in the frontmatter, and look at it with `just drafts` in both themes:

   ```yaml
   art: my-post.art.txt
   ```

Commit the map before running `just publish`, which commits only the post and stops on any other change in the tree.
