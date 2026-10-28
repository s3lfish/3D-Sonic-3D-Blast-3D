# Chili dog meter: how it is worked out

`tools/footprint.py` keeps the estimate in the README current. Every figure is rough: the true numbers could be
about four times lower or higher.

## Electricity

Anthropic has not published energy figures for its models, so the per-token figures borrow published estimates for
other large models (mWh per token, low / middle / high):

| Tokens | Low | Middle | High | Why |
| --- | --- | --- | --- | --- |
| New input, written to the prompt cache | 0.10 | 0.17 | 0.25 | Epoch AI: about 2.5 Wh for a 10,000-token prompt |
| Output, written on top of a long context | 0.5 | 1.5 | 5 | 1.8 to 39 Wh for long prompts and reasoning models (Jegham et al.) |
| Read back from the prompt cache | 0.001 | 0.004 | 0.01 | my estimate: the cache skips reprocessing |

Calls recorded in Claude's session transcripts are counted token by token. The first three days left no per-call
record, so they are estimated as 2,000 to 8,000 calls (97 commits at 25 to 80 calls each) at 1.2 to 7 Wh a call, the
range the first measured stretch gave. The cloud machine that ran the emulator and tests (perhaps 1 to 2 kWh) is
left out.

## Water

Cooling water at the data centre only, at Google's ratio for a median Gemini prompt (0.26 mL for 0.24 Wh, about
1.1 mL per Wh). Water used to generate the electricity is left out; it could add a few times as much.

## One chili dog

A 50 g beef frank, 60 g of chili holding 25 g of beef, and a 50 g bun.

- Energy: beef at 210 MJ of non-renewable energy per kg (19.1% of the 1,100 MJ/kg cumulative energy demand in the US
  beef study of Asem-Hiablie et al., 2019), bread at 20 MJ/kg (the middle of 9 to 32.9 MJ/kg for 21 EU breads), and
  0.1 kWh to cook it: about 4.8 kWh. This is primary energy, while the project's figure is electricity, which takes
  roughly two to three times as much primary energy to make.
- Water: irrigation (blue) water only, so it compares with the data centre's cooling water: beef 15,415 L/kg in all,
  about 4% of it blue; bread 1,608 L/kg, 10% blue (assumed): about 54 L. Counting rain on the fields as well, one
  chili dog takes about 1,250 L.

## Sources

- Google: [Measuring the environmental impact of delivering AI at Google scale](https://arxiv.org/abs/2508.15734)
- [IntuitionLabs: AI inference energy per task](https://intuitionlabs.ai/pdfs/ai-inference-energy-joules-per-task.pdf) (collects Epoch AI and Jegham et al.)
- Asem-Hiablie et al. (2019): [a life cycle assessment of the US beef value chain](https://link.springer.com/article/10.1007%2Fs11367-018-1464-6)
- [Energy flows of EU national breads](https://agris.fao.org/search/en/records/68879c487fd4d06c32a97929)
- [Heinrich Böll Foundation, Meat Atlas: beef 15,415 L/kg](https://eu.boell.org/en/2021/09/07/water-thirsty-animals-thirsty-crops)
- [NFU: about 4% of beef's water footprint is blue](https://www.nfuonline.com/updates-and-information/water-use-and-beef-what-we-know)
- [Enel: bread 1,608 L/kg](https://www.enel.com/learning-hub/environment/water-footprint)
