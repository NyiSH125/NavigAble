# NavigAble demo runbook

**URL:** `TODO paste the Vercel URL here after deploying`

**Backup recording:** `TODO path or link to the 60 second capture`

Read this once before you present. The three minute walkthrough is section 2.

---

## 1. The pitch, in three sentences

> Accessibility maps today tell you whether a building has a ramp. They do not
> tell you whether you can get to the door, and they treat every disabled person
> as the same person.
>
> NavigAble takes a photo of an obstacle, classifies it independently for four
> profiles, and routes around the ones that block you specifically. A flight of
> steps is impassable in a wheelchair and a minor inconvenience with a cane, and
> the same obstacle scores 3 and 1.
>
> The map is the picture. The list is the product: every pin, severity, and route
> step is text, keyboard reachable, and screen reader readable, because an
> accessibility tool that only works for sighted mouse users is not one.

## 2. Three minute walkthrough

Do these in order. Every step has a fallback if the network misbehaves.

**0:00 Open the URL.** Six obstacles are on the map near the venue. Say: this is
the same data twice, a map for people who want a map, and a list that is the
canonical record.

**0:20 Show the per-profile insight.** In the list, point at the stairs-only
entrance: **Impassable (3 of 3)** for wheelchair. Now change **Your profile** to
**Walker or cane**. The same obstacle drops to **Difficult (2 of 3)** and the list
reorders, because broken pavement now outranks it. This is the core idea, and it
takes ten seconds to show.

**0:50 Open one report.** Press Enter on a row. The detail panel shows all four
profiles at once, the photo, the age, the confirmation count, and the model's
confidence. Point out that severity is never colour alone: every level has a
shape and a written label.

**1:20 File a report live.** Open **Report an obstacle**, take a photo of
something that is a walkway, entrance, or crossing, then set the location one of
three ways: **Use my location** on a phone, **Choose on map** and click the spot,
or type coordinates. Then submit. It comes back classified for all four profiles and lands
on the map.

- Classification usually takes 3 to 8 seconds, and can take up to 35 under load.
  Keep talking while the skeleton is up. That delay is a real model call, which
  is the point.
- **A photo of the room, a laptop, or a face is rejected on purpose** with "not a
  public walkway, entrance, crossing, or transit access point" and nothing is
  stored. That is a feature: show it deliberately if you have time, and never by
  accident. **Photograph a floor, a doorway, or a kerb.**
- If it fails twice, stop and move on. Section 3 covers what to say.

**2:00 Route around the obstacles.** Open **Plan a route**, tap **Use my
location**, pick a destination, and find the route. Read the summary: distance,
time, and **obstacles avoided**. Then switch profile from **Wheelchair** to
**Blind** and the route changes, because the two profiles are blocked by
different things.

Measured on the seeded data, same start and destination:

| Profile | Distance | Steps | Obstacles avoided |
| --- | --- | --- | --- |
| Wheelchair | 396 m | 11 | 5 |
| Blind | 416 m | 12 | 5 |
| Walker or cane | 424 m | 12 | 4 |
| Low vision | 416 m | 12 | 3 |
| Ignoring obstacles | 378 m | 11 | 0 |

The comparison line states the cost in words: **18 metres longer than the direct
route, which passes 5 obstacles this profile cannot use.**

**2:40 Close on accessibility.** Tab through the interface with your hands off the
mouse. Filters, list, report, route steps: 52 focus stops, every one with a name,
and the map canvas is deliberately not one of them.

## 3. If something breaks

| Symptom | Say this, then do this |
| --- | --- |
| Map is blank, list works | "The canvas is decorative, everything is in the list." Carry on in the list. |
| Classification fails twice | "That is a live model call and the service is under load right now." Play the recording. |
| Route fails | Switch to a nearer destination. Preset destinations are in `lib/places.ts`. |
| Nothing loads at all | Play the recording. Do not debug in front of judges. |

## 4. Before you present

- [ ] Open the URL on your phone and confirm six pins and six list rows
- [ ] Seed data sits where you are standing: `npx tsx scripts/seed-fake.ts --center=<lng,lat> --reset`
- [ ] `NEXT_PUBLIC_DEFAULT_CENTER` in Vercel matches that same point, then redeploy
- [ ] Destinations in `lib/places.ts` are near the venue, then redeploy
- [ ] Submit one test report from the phone you will demo on, then delete it:
      `npx tsx scripts/seed-fake.ts --reset` removes seeds only, so delete a live
      test row from the Supabase table editor
- [ ] Recording captured and playable offline
- [ ] Phone screen brightness up, notifications off

## 5. Known limits, if a judge asks

Say these plainly. They are design decisions with reasons, not gaps you missed.

- **No accounts.** Reports are anonymous with a local id. Confirm and dispute
  counts exist in the schema and are shown, but voting is not built.
- **Rate limiter is in memory,** so it is per server instance. Fine for one
  instance, needs a shared store to scale.
- **No address search.** Destinations are a fixed list, because a geocoder was not
  worth the time against routing.
- **Photos keep their EXIF.** Uploads should be stripped before real use, since the
  report already carries its own coordinates.
- **Seeded rows are labelled** as fabricated examples, in the data and on the
  placeholder images. Nothing pretends to be evidence.
- **The classifier is not a substitute for a survey.** It reports what is visible
  in one photo, at a stated confidence, and says when it cannot see the ground.
