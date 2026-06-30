# word_lab manual - Precision

> Source: Cider Institute of North America course materials

## Precision


To be valid, a method must be both accurate and precise. Precision can be thought of as a measurement of the measurement. Colloquially we use the term precision to mean two related but different concepts: repeatability (a measure of how close two measurements of the same sample are) and degree of increment (a measure of the spaces between measuring ticks). Both meanings, though slightly different, impact the ability of the method to test the same sample and produce the same result.

The repeatability or reproducibility of the method is measured by testing a sample several times and calculating how closely the results match each other. There are several methods of calculating this agreement. Some labs will use standard deviation as a measure of agreement, however most use the coefficient of variation (CV). CV is the most useful measurement of precision because it is relative to the size of the actual result. It is calculated by dividing standard deviation by the average result.

In the example in Table 3, a technician has measured the TA of the same cider using the same equipment and reagents three times. The results were 5.6, 5.5, and 5.1 g/L malic acid. The average of these results is 5.4 g/L and the standard deviation is 0.26 g/L. What does that mean? Imagine the technician were to continue to take measurements and the results followed the same amount of repeatability as the first three measurements. The standard deviation indicates that most likely around 70% of all future measurements made will be somewhere between 5.1 g/L and 5.7 g/L (5.4 g/L +/- 0.26 g/L). To find the standard deviation, you can use one of the many online calculators, or use the “=STDEV()” function in Microsoft Excel.

Table 3: Example measurements, standard deviation, and coefficient of variation

But is a standard deviation of 0.26 g/L good or bad? It really depends upon how big the measurement is. If the measurement was 0.30 g/L and the standard deviation is 0.26 g/L, then your result is 0.30 +/- 0.26 g/L. Not great. But if your measurement was 300 g/L, then your result would be 300 +/- 0.26 g/L. That’s a lot better. To capture this idea, many labs use the coefficient of variation to report their repeatability (Equation 1).

Equation 1: Coefficient of variation

In the example in Table 3, the CV is 4.9%. How do we interpret that? Essentially this means the result is 5.4 +/- 4.9%. All of the measurements were within about 5% of the average. Each lab or cidery must decide for itself what an acceptable CV is, or, put another way, how much “plus or minus” is okay. For most analytical labs anything lower than 5% CV is acceptable.

Note that standard deviation and CV are measurements of precision; they give us no indication of whether this result is accurate or not. The ‘true’ value could be anything, the standard deviation and CV only tell us how precise, or how repeatable, the measurements are. If there is something wrong with the method, you might get great precision (results that agree with each other) but still have poor accuracy (results that do not represent the ‘true’ value.)

The second understanding of the term, ‘precision’ relates to the degree of increment of your measuring equipment. Imagine someone wants to know how many litres of water are in their bathtub and the only thing they have to measure with is a jug that holds exactly 1 L of water. They start scooping water out of the tub with the jug. Each scoopful is recorded as 1 litre. After four scoopfuls, most of the water is gone. They scoop the remaining bit of water into the jug and it fills about halfway. This person knows for sure there was at least 4 L of water in the tub and estimates that the half-filled jug has about 0.5 litres. They report the result as 4.5 L.

Imagine then, a second person repeats the measurement using the same tools (the exact same amount of water is magically replaced inside the tub). The second person scoops out the first four jugs and then is left with a partially filled jug at the end, just as the first person was. Both agree that there is at least 4 L of water, but the second person estimates the amount of water in the last, partially filled jug to be 0.3 L. They report the result as 4.3 L.

Which person is right? The answer is neither or both. This is a limitation of the measuring system. We can only say for certain that there was 4 L of water in the tub plus or minus 1 L. There is no way to know exactly how much water was in the last jug, so the last digits (0.5 and 0.3) are just guesses. The same is true for all measurements: the last digit recorded is always an estimate.

Next, imagine that instead of a 1 L jug, a 100 mL jug is used to measure the volume of water in the tub (that’s 0.1 L). With this smaller measuring device, the first person scoops a full jug of water out of the tub 44 times. The last bit of water once again fills the jug about halfway. There is at least 4.4 L in the tub (44 x 0.1 L) and the first person estimates that the last jug is about half full (0.05 L), and reports the result as 4.45 L. The second person estimates that the last jug contains 0.03 L, and they report the result as 4.43 L.

This method has greater precision, because with the smaller increment of measurement, the two people agree much more closely than they did when using the 1 L jug (Figure 1).

In practice, this means every measurement will end with an estimated value. A measurement of 23.4 mL is not precisely 23.4 mL, but is, in fact, 23 mL plus or minus 1 mL. Just from looking at the reported amount, we know that the smallest increment or graduation on the piece of equipment used to measure that volume was 1 mL. This is why 23 mL and 23.0 mL are not the same measurement. The first (23 mL) indicates the measurement is 20 mL plus or minus 10 mL and the last digit (3) is just an estimate. The second measurement (23.0 mL) indicates the measurement is 23 mL plus or minus 1 mL) as, again, the last digit (0) is just an estimate.